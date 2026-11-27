import assert from "node:assert/strict";
import { compileRuntimeScript } from "../src/build/runtime-scripts";
import test from "node:test";
import vm from "node:vm";
import type { PageRequest, PageResponses, StorageChanges, StoredValues } from "../src/lib/extension-types";

type RuntimeReply = PageResponses[keyof PageResponses];
type RuntimeListener = (message: PageRequest & { hostname?: string }, sender: object, reply: (value: RuntimeReply) => void) => void;
type StorageListener = (changes: StorageChanges, area: string) => void;

interface ElementState {
  clicks: number;
  highlights: number;
  disabled: boolean;
  connected: boolean;
  display: string;
  visibility: string;
  opacity: string;
  width: number;
  height: number;
}

const scripts = ["site-rules.js", "picker.js", "content.js"] as const;
const contentScript = scripts.map(compileRuntimeScript).join("\n");
const siteKey = "siteSelectors:example.com";

function createElement(options: Partial<ElementState> & { disabledAncestor?: boolean } = {}, descendants: Record<string, object[]> = {}) {
  const state = {
    clicks: 0,
    highlights: 0,
    disabled: false,
    connected: true,
    display: "block",
    visibility: "visible",
    opacity: "1",
    width: 20,
    height: 20,
    ...options
  };

  let priority = "";
  let inlineDisplay = "";
  return {
    state,
    style: {
      getPropertyValue() { return inlineDisplay; },
      getPropertyPriority() { return priority; },
      setProperty(_key: string, value: string, nextPriority = "") {
        inlineDisplay = value;
        priority = nextPriority;
        state.display = value;
      },
      removeProperty() {
        inlineDisplay = "";
        priority = "";
        state.display = options.display ?? "block";
      }
    },
    querySelectorAll(selector: string) { return descendants[selector] ?? []; },
    get isConnected() {
      return state.connected;
    },
    matches(selector: string) {
      return selector.includes(":disabled") && state.disabled;
    },
    closest(selector: string) {
      return selector.includes(":disabled") && (state.disabled || options.disabledAncestor) ? this : null;
    },
    getBoundingClientRect() {
      return { width: state.width, height: state.height };
    },
    getClientRects() {
      return [{ left: 0, top: 0, right: state.width, bottom: state.height }];
    },
    contains(node: unknown) {
      return node === this;
    },
    click() {
      state.clicks += 1;
    },
    animate() {
      state.highlights += 1;
      return { cancel() {} };
    }
  };
}

interface ContentFixture {
  config: StoredValues;
  elementsBySelector?: Record<string, ReturnType<typeof createElement>[]>;
  invalidSelectors?: string[];
  url?: string;
  authorized?: boolean;
  reinject?: boolean;
  browserClick?: { hit: ReturnType<typeof createElement>; success: boolean };
  now?: () => number;
}

async function startContentScript({
  config,
  elementsBySelector = {},
  invalidSelectors = [],
  url = "https://example.com/",
  authorized = true,
  reinject = false,
  browserClick,
  now = Date.now
}: ContentFixture) {
  const runtimeListeners: RuntimeListener[] = [];
  const storageListeners: StorageListener[] = [];
  const messages: { type: string; [key: string]: unknown }[] = [];
  const timeouts = new Map<number, () => void>();
  let nextTimeoutId = 0;
  let observer: MockMutationObserver | undefined;

  class MockMutationObserver {
    options?: MutationObserverInit;

    constructor(private callback: () => void) {
      observer = this;
    }

    observe(_target: object, options: MutationObserverInit) {
      this.options = options;
    }

    disconnect() {
      this.options = undefined;
    }

    notify(type: keyof MutationObserverInit) {
      if (this.options?.[type]) this.callback();
    }
  }

  const document = {
    documentElement: { clientWidth: 800, clientHeight: 600 },
    visibilityState: "visible",
    addEventListener() {},
    elementFromPoint: () => browserClick?.hit ?? null,
    querySelectorAll(selector: string) {
      if (invalidSelectors.includes(selector)) {
        throw new Error(`Invalid selector: ${selector}`);
      }
      return elementsBySelector[selector] || [];
    }
  };

  const sandbox = {
    Date: { now },
    URL,
    location: { href: url },
    document,
    MutationObserver: MockMutationObserver,
    window: {
      getComputedStyle(element: ReturnType<typeof createElement>) {
        return {
          display: element.state.display,
          visibility: element.state.visibility,
          opacity: element.state.opacity
        };
      },
      setTimeout(callback: () => void) {
        const id = ++nextTimeoutId;
        timeouts.set(id, callback);
        return id;
      },
      clearTimeout(id: number) {
        timeouts.delete(id);
      }
    },
    chrome: {
      runtime: {
        sendMessage(message: typeof messages[number]) {
          messages.push(message);
          return Promise.resolve(message.type === "browser-click" ? { ok: browserClick?.success } : undefined);
        },
        getManifest: () => ({ permissions: browserClick ? ["debugger"] : [] }),
        onMessage: {
          addListener(listener: RuntimeListener) {
            runtimeListeners.push(listener);
          }
        }
      },
      storage: {
        local: {
          get() {
            const address = new URL(url);
            const patterns = authorized ? [`${address.protocol}//${address.hostname}/*`] : [];
            return Promise.resolve({ authorizedSitePatterns: patterns, experimentalBrowserClick: Boolean(browserClick) });
          }
        },
        sync: {
          get(defaults: StoredValues) {
            const settings = { ...defaults };
            for (const key of Object.keys(defaults)) {
              if (Object.hasOwn(config, key)) settings[key] = config[key];
            }
            return Promise.resolve(settings);
          }
        },
        onChanged: {
          addListener(listener: StorageListener) {
            storageListeners.push(listener);
          }
        }
      }
    }
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(contentScript, context, { filename: "content.js" });
  if (reinject) vm.runInContext(contentScript, context, { filename: "content.js" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(observer);
  return {
    messages,
    runtimeListeners,
    storageListeners,
    observer,
    timeouts,
    runScheduledScans() {
      for (const [id, callback] of [...timeouts]) {
        timeouts.delete(id);
        callback();
      }
    }
  };
}

function sendMessage<Message extends PageRequest & { hostname?: string }>(
  listener: RuntimeListener, message: Message
): PageResponses[Message["type"]] {
  let response: RuntimeReply | undefined;
  listener(message, {}, (value) => {
    response = value;
  });
  assert.ok(response);
  return response as PageResponses[Message["type"]];
}

function toPlainObject(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test("experimental mode counts only successful browser clicks and never falls back to script", async () => {
  const target = createElement();
  const browserClick = { hit: target, success: false };
  let time = 10_000;
  const app = await startContentScript({
    config: { enabled: true, [siteKey]: [".ad-close"], cooldown: 1000 },
    elementsBySelector: { ".ad-close": [target] },
    browserClick,
    now: () => time
  });

  assert.deepEqual(app.messages.map(({ type }) => type), ["browser-click"]);
  assert.equal(target.state.clicks, 0);
  assert.equal(sendMessage(app.runtimeListeners[0], { type: "get-status" }).totalClicks, 0);

  time += 1000;
  browserClick.success = true;
  app.observer.notify("attributes");
  app.runScheduledScans();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(app.messages.map(({ type }) => type), ["browser-click", "browser-click", "click-record"]);
  assert.equal(sendMessage(app.runtimeListeners[0], { type: "get-status" }).totalClicks, 1);
  assert.equal(target.state.clicks, 0);
});

test("clicks visible matching elements after the configuration loads", async () => {
  const closeButton = createElement();
  const app = await startContentScript({
    config: {
      enabled: true,
      [siteKey]: [".ad-close"],
      cooldown: 8000
    },
    elementsBySelector: { ".ad-close": [closeButton] }
  });

  assert.equal(closeButton.state.clicks, 1);
  assert.equal(app.timeouts.size, 0);
  assert.deepEqual(toPlainObject(app.messages[0]), {
    type: "click-record",
    totalClicks: 1,
    ruleIds: ["selector:.ad-close"]
  });
});

test("clicks a unique real button within a matched wrapper and waits for the button to appear", async () => {
  const button = createElement({ display: "none" });
  const wrapper = createElement({}, { button: [button] });
  const selector = '[id="skip-button:v"]';
  const app = await startContentScript({
    config: { enabled: true, [siteKey]: [selector] },
    elementsBySelector: { [selector]: [wrapper] }
  });
  assert.equal(button.state.clicks, 0);
  assert.equal(wrapper.state.clicks, 0);

  button.state.display = "block";
  app.observer.notify("attributes");
  app.runScheduledScans();
  assert.equal(button.state.clicks, 1);
  assert.equal(wrapper.state.clicks, 0);
  assert.equal(app.messages.filter((message) => message.type === "click-record").length, 1);
});

test("matches a child element without activating a disabled enclosing control", async () => {
  const nested = createElement();
  const blocked = createElement({ disabledAncestor: true });
  const app = await startContentScript({
    config: { enabled: true, [siteKey]: ["button > .label", "button > .blocked"] },
    elementsBySelector: { "button > .label": [nested], "button > .blocked": [blocked] }
  });
  assert.equal(nested.state.clicks, 1);
  assert.equal(blocked.state.clicks, 0);
  assert.equal(sendMessage(app.runtimeListeners[0], {
    type: "test-rule", hostname: "example.com", selector: "button > .blocked"
  }).status, "disabled");
});

test("hides a single element and only the cards with the selected marker text, even with clicking off", async () => {
  const adMarker = { textContent: " Ad  " };
  const regularMarker = { textContent: "Featured" };
  const adCard = createElement({}, { ".label": [adMarker] });
  const regularCard = createElement({}, { ".label": [regularMarker] });
  const popup = createElement();
  popup.style.setProperty("display", "grid", "important");
  const rulesKey = "siteHideRules:example.com";
  const direct = { id: "popup", selector: "#notice", name: "", paused: false };
  const conditional = {
    id: "ad", selector: ".card", name: "Ad card", paused: false,
    contains: { selector: ".label", text: "Ad" }
  };
  const cards = [adCard, regularCard];
  const app = await startContentScript({
    config: { enabled: false, [rulesKey]: [direct, conditional] },
    elementsBySelector: { "#notice": [popup], ".card": cards }
  });

  assert.equal(popup.state.display, "none");
  assert.equal(adCard.state.display, "none");
  assert.equal(regularCard.state.display, "block");
  assert.equal(app.messages.some((message) => message.type === "click-record"), false);

  const newCard = createElement({}, { ".label": [{ textContent: "Ad" }] });
  cards.push(newCard);
  adMarker.textContent = "Featured";
  regularMarker.textContent = "Ad";
  app.observer.notify("characterData");
  app.runScheduledScans();
  assert.equal(adCard.state.display, "block");
  assert.equal(regularCard.state.display, "none");
  assert.equal(newCard.state.display, "none");

  const [storageChanged] = app.storageListeners;
  storageChanged({ [rulesKey]: { newValue: [direct, { ...conditional, paused: true }] } }, "sync");
  assert.equal(regularCard.state.display, "block");
  assert.equal(newCard.state.display, "block");
  assert.equal(popup.state.display, "none");

  storageChanged({ hideEnabled: { newValue: false } }, "sync");
  assert.equal(popup.state.display, "grid");
  assert.equal(popup.style.getPropertyPriority(), "important");
  assert.equal(app.observer.options, undefined);
});

test("scans when an existing matching element becomes visible after an attribute change", async () => {
  const closeButton = createElement({ display: "none" });
  const app = await startContentScript({
    config: { enabled: true, [siteKey]: [".ad-close"] },
    elementsBySelector: { ".ad-close": [closeButton] }
  });

  assert.equal(closeButton.state.clicks, 0);
  assert.equal(app.observer.options?.subtree, true);
  closeButton.state.display = "block";
  app.observer.notify("attributes");
  assert.equal(app.timeouts.size, 1);
  app.runScheduledScans();
  assert.equal(closeButton.state.clicks, 1);
  assert.equal(app.timeouts.size, 0);
});

test("scans after insertion and batches mutations without delaying the pending scan", async () => {
  const matches: ReturnType<typeof createElement>[] = [];
  const closeButton = createElement();
  const app = await startContentScript({
    config: { enabled: true, [siteKey]: [".ad-close"] },
    elementsBySelector: { ".ad-close": matches }
  });

  matches.push(closeButton);
  app.observer.notify("childList");
  assert.equal(app.timeouts.size, 1);
  const [scheduledScan] = app.timeouts.keys();
  app.observer.notify("attributes");
  app.observer.notify("childList");
  assert.deepEqual([...app.timeouts.keys()], [scheduledScan]);
  app.runScheduledScans();
  assert.equal(closeButton.state.clicks, 1);
});

test("does not click hidden, disabled, or detached matching elements", async () => {
  const hiddenButton = createElement({ display: "none" });
  const disabledButton = createElement({ disabled: true });
  const detachedButton = createElement({ connected: false });

  const app = await startContentScript({
    config: {
      enabled: true,
      [siteKey]: [".hidden", ".disabled", ".detached"],
      cooldown: 8000
    },
    elementsBySelector: {
      ".hidden": [hiddenButton],
      ".disabled": [disabledButton],
      ".detached": [detachedButton]
    }
  });

  assert.equal(hiddenButton.state.clicks, 0);
  assert.equal(disabledButton.state.clicks, 0);
  assert.equal(detachedButton.state.clicks, 0);
  assert.equal(app.messages.length, 0);
});

test("observes and clicks a site rule only on its saved hostname", async () => {
  const matchingSite = createElement();
  const differentSite = createElement();
  const config = { enabled: true, [siteKey]: [".ad-close"] };
  const app = await startContentScript({
    config,
    elementsBySelector: { ".ad-close": [matchingSite] },
    url: "https://example.com/another-page"
  });
  const otherApp = await startContentScript({
    config,
    elementsBySelector: { ".ad-close": [differentSite] },
    url: "https://sub.example.com/"
  });

  assert.equal(matchingSite.state.clicks, 1);
  assert.equal(app.observer.options?.childList, true);
  assert.equal(differentSite.state.clicks, 0);
  assert.equal(otherApp.observer.options, undefined);
});

test("ignores legacy global rules on both automatic and manual scans", async () => {
  const legacyButton = createElement();
  const siteButton = createElement();
  const app = await startContentScript({
    config: { enabled: true, selectors: [".legacy-close"], [siteKey]: [".site-close"] },
    elementsBySelector: { ".legacy-close": [legacyButton], ".site-close": [siteButton] }
  });

  assert.equal(siteButton.state.clicks, 1);
  assert.equal(legacyButton.state.clicks, 0);
  app.storageListeners[0]({ selectors: { newValue: [".legacy-close"] } }, "sync");
  sendMessage(app.runtimeListeners[0], { type: "scan-now" });
  assert.equal(legacyButton.state.clicks, 0);
});

test("skips an ambiguous site rule until it has exactly one match", async () => {
  const closeButton = createElement();
  const otherButton = createElement();
  const matches = [closeButton, otherButton];
  const app = await startContentScript({
    config: { enabled: true, [siteKey]: [".ad-close"] },
    elementsBySelector: { ".ad-close": matches }
  });

  assert.equal(closeButton.state.clicks, 0);
  assert.equal(otherButton.state.clicks, 0);
  matches.pop();
  app.observer.notify("childList");
  app.runScheduledScans();
  assert.equal(closeButton.state.clicks, 1);
  assert.equal(otherButton.state.clicks, 0);
});

test("applies a new site rule and disconnects after the last rule is removed", async () => {
  const closeButton = createElement();
  const app = await startContentScript({
    config: { enabled: true },
    elementsBySelector: { ".ad-close": [closeButton] }
  });
  const initialOptions = app.observer.options;
  assert.equal(initialOptions, undefined);
  app.storageListeners[0]({ [siteKey]: { newValue: [".ad-close"] } }, "sync");
  assert.equal(closeButton.state.clicks, 1);
  assert.equal(app.observer.options?.childList, true);
  app.storageListeners[0]({ [siteKey]: { oldValue: [".ad-close"] } }, "sync");
  assert.equal(app.observer.options, undefined);
});

test("respects the cooldown and applies changes to an open page", async () => {
  let time = 0;
  const closeButton = createElement();
  const app = await startContentScript({
    config: {
      enabled: true,
      [siteKey]: [".ad-close"],
      cooldown: 8000
    },
    elementsBySelector: { ".ad-close": [closeButton] },
    now: () => time
  });

  time = 2000;
  const response = sendMessage(app.runtimeListeners[0], { type: "scan-now" });

  assert.equal(closeButton.state.clicks, 1);
  assert.deepEqual(toPlainObject(response), { totalClicks: 1 });

  app.storageListeners[0]({ cooldown: { newValue: 2000 } }, "sync");
  assert.equal(closeButton.state.clicks, 2);
  assert.equal(sendMessage(app.runtimeListeners[0], { type: "scan-now" }).totalClicks, 2);
});

test("tests saved rules without clicking or recording statistics", async () => {
  const target = createElement();
  const hidden = createElement({ display: "none" });
  const app = await startContentScript({
    config: { [siteKey]: ["#ready", "#hidden", "#multiple", "#missing"] },
    elementsBySelector: { "#ready": [target], "#hidden": [hidden], "#multiple": [target, hidden] }
  });
  const diagnose = (selector: string) => sendMessage(app.runtimeListeners[0], {
    type: "test-rule", hostname: "example.com", selector
  });
  assert.equal(diagnose("#ready").status, "ready");
  assert.equal(target.state.highlights, 1);
  assert.equal(diagnose("#hidden").status, "hidden");
  assert.equal(diagnose("#multiple").count, 2);
  assert.equal(diagnose("#missing").status, "missing");
  assert.equal(diagnose("#removed").status, "removed");
  assert.equal(target.state.clicks, 0);
  assert.equal(app.messages.some((message) => message.type === "click-record"), false);
});

test("keeps scanning valid selectors when another selector is invalid", async () => {
  const closeButton = createElement();
  await startContentScript({
    config: {
      enabled: true,
      [siteKey]: ["[", ".ad-close"],
      cooldown: 8000
    },
    invalidSelectors: ["["],
    elementsBySelector: { ".ad-close": [closeButton] }
  });

  assert.equal(closeButton.state.clicks, 1);
});

test("stops clicking after the extension is disabled through storage", async () => {
  const closeButton = createElement();
  const app = await startContentScript({
    config: {
      enabled: true,
      [siteKey]: [".ad-close"],
      cooldown: 8000
    },
    elementsBySelector: { ".ad-close": [closeButton] }
  });

  app.observer.notify("childList");
  assert.equal(app.timeouts.size, 1);
  app.storageListeners[0]({ enabled: { newValue: false } }, "sync");
  assert.equal(app.observer.options, undefined);
  assert.equal(app.timeouts.size, 0);
  sendMessage(app.runtimeListeners[0], { type: "scan-now" });

  assert.equal(closeButton.state.clicks, 1);
  assert.deepEqual(toPlainObject(app.messages.at(-1)), { type: "reset-badge" });
});

test("disconnects scanning when all rules are paused and resumes a single rule immediately", async () => {
  const pausedButton = createElement();
  const activeButton = createElement();
  const detailsKey = "siteRuleDetails:example.com";
  const app = await startContentScript({
    config: {
      enabled: true,
      [siteKey]: ["#one", "#two"],
      [detailsKey]: { "selector:#one": { paused: true } }
    },
    elementsBySelector: { "#one": [pausedButton], "#two": [activeButton] }
  });
  assert.equal(pausedButton.state.clicks, 0);
  assert.equal(activeButton.state.clicks, 1);
  const update = (changes: StorageChanges) => app.storageListeners[0](changes, "sync");
  update({ [detailsKey]: { newValue: { "selector:#one": { paused: true }, "selector:#two": { paused: true } } } });
  assert.equal(app.observer.options, undefined);
  sendMessage(app.runtimeListeners[0], { type: "scan-now" });
  assert.equal(pausedButton.state.clicks, 0);
  const testRule = (selector: string) => sendMessage(app.runtimeListeners[0], {
    type: "test-rule", hostname: "example.com", selector
  });
  assert.equal(testRule("#two").status, "rule-paused");
  update({ [detailsKey]: { newValue: { "selector:#two": { paused: true } } } });
  assert.equal(pausedButton.state.clicks, 1);
  assert.equal(activeButton.state.clicks, 1);
  assert.ok(app.observer.options);
});

test("honors a legacy site pause until the rule details are migrated", async () => {
  const first = createElement();
  const second = createElement();
  const pausedKey = "sitePaused:example.com";
  const detailsKey = "siteRuleDetails:example.com";
  const app = await startContentScript({
    config: { enabled: true, [siteKey]: ["#one", "#two"], [pausedKey]: true },
    elementsBySelector: { "#one": [first], "#two": [second] }
  });
  assert.equal(app.observer.options, undefined);
  assert.equal(first.state.clicks, 0);
  assert.equal(second.state.clicks, 0);
  app.storageListeners[0]({
    [detailsKey]: { newValue: { "selector:#two": { paused: true } } },
    [pausedKey]: { newValue: false }
  }, "sync");
  assert.equal(first.state.clicks, 1);
  assert.equal(second.state.clicks, 0);
});

test("enforces a segment-safe path prefix and a page limit when the target is replaced", async () => {
  const first = createElement();
  const second = createElement();
  const matches = [first];
  const config = {
    enabled: true,
    [siteKey]: ["#close"],
    "siteRuleDetails:example.com": { "selector:#close": { pathPrefix: "/dashboard/", maxClicks: 1 } }
  };
  await startContentScript({ config, url: "https://example.com/dashboard-archive", elementsBySelector: { "#close": matches } });
  assert.equal(first.state.clicks, 0);
  const app = await startContentScript({ config, url: "https://example.com/dashboard/view", elementsBySelector: { "#close": matches } });
  assert.equal(first.state.clicks, 1);
  matches[0] = second;
  sendMessage(app.runtimeListeners[0], { type: "scan-now" });
  assert.equal(second.state.clicks, 0);
  assert.equal(sendMessage(app.runtimeListeners[0], {
    type: "test-rule", hostname: "example.com", selector: "#close"
  }).status, "limit-reached");
});

test("runs only for the authorized origin and stops an open tab when access is revoked", async () => {
  const target = createElement();
  const app = await startContentScript({
    authorized: false,
    reinject: true,
    config: { enabled: true, [siteKey]: ["#close"] },
    elementsBySelector: { "#close": [target] }
  });
  const changeAccess = (newValue: string[]) => app.storageListeners[0]({ authorizedSitePatterns: { newValue } }, "local");
  assert.equal(app.runtimeListeners.length, 1);
  assert.equal(app.observer.options, undefined);
  changeAccess(["http://example.com/*", "https://other.example/*"]);
  assert.equal(target.state.clicks, 0);
  changeAccess(["https://example.com/*"]);
  assert.equal(target.state.clicks, 1);
  app.observer.notify("childList");
  changeAccess([]);
  assert.equal(app.observer.options, undefined);
  assert.equal(app.timeouts.size, 0);
  assert.equal(sendMessage(app.runtimeListeners[0], { type: "get-status" }).authorized, false);
});
