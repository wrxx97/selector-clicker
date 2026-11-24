const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const contentScript = ["site-rules.js", "picker.js", "content.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
  .join("\n");
const siteKey = "siteSelectors:example.com";

function createElement(options = {}) {
  const state = {
    clicks: 0,
    disabled: false,
    connected: true,
    display: "block",
    visibility: "visible",
    opacity: "1",
    width: 20,
    height: 20,
    ...options
  };

  return {
    state,
    get isConnected() {
      return state.connected;
    },
    matches() {
      return state.disabled;
    },
    getBoundingClientRect() {
      return { width: state.width, height: state.height };
    },
    click() {
      state.clicks += 1;
    }
  };
}

async function startContentScript({
  config,
  elementsBySelector = {},
  invalidSelectors = [],
  url = "https://example.com/"
}) {
  const runtimeListeners = [];
  const storageListeners = [];
  const messages = [];
  const timeouts = new Map();
  let nextTimeoutId = 0;
  let observer;

  const document = {
    documentElement: {},
    querySelectorAll(selector) {
      if (invalidSelectors.includes(selector)) {
        throw new Error(`Invalid selector: ${selector}`);
      }
      return elementsBySelector[selector] || [];
    }
  };

  const sandbox = {
    Date,
    URL,
    location: { href: url },
    document,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        observer = this;
      }
      observe(_target, options) {
        this.options = options;
      }
      disconnect() {
        this.options = undefined;
      }
      notify(type) {
        if (this.options?.[type]) this.callback();
      }
    },
    window: {
      getComputedStyle(element) {
        return {
          display: element.state.display,
          visibility: element.state.visibility,
          opacity: element.state.opacity
        };
      },
      setTimeout(callback) {
        const id = ++nextTimeoutId;
        timeouts.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timeouts.delete(id);
      }
    },
    chrome: {
      runtime: {
        sendMessage(message) {
          messages.push(message);
        },
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          }
        }
      },
      storage: {
        sync: {
          get(defaults) {
            const settings = { ...defaults };
            for (const key of Object.keys(defaults)) {
              if (Object.hasOwn(config, key)) settings[key] = config[key];
            }
            return Promise.resolve(settings);
          }
        },
        onChanged: {
          addListener(listener) {
            storageListeners.push(listener);
          }
        }
      }
    }
  };

  vm.runInNewContext(contentScript, sandbox, { filename: "content.js" });
  await new Promise((resolve) => setImmediate(resolve));

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

function sendMessage(listener, message) {
  let response;
  listener(message, {}, (value) => {
    response = value;
  });
  return response;
}

function toPlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

test("clicks visible matching elements after the configuration loads", async () => {
  const closeButton = createElement();
  const app = await startContentScript({
    config: {
      enabled: true,
      selectors: [".ad-close"],
      cooldown: 8000
    },
    elementsBySelector: { ".ad-close": [closeButton] }
  });

  assert.equal(closeButton.state.clicks, 1);
  assert.equal(app.timeouts.size, 0);
  assert.deepEqual(toPlainObject(app.messages[0]), {
    type: "click-record",
    totalClicks: 1,
    selector: ".ad-close"
  });
});

test("scans when an existing matching element becomes visible after an attribute change", async () => {
  const closeButton = createElement({ display: "none" });
  const app = await startContentScript({
    config: { enabled: true, selectors: [".ad-close"] },
    elementsBySelector: { ".ad-close": [closeButton] }
  });

  assert.equal(closeButton.state.clicks, 0);
  assert.equal(app.observer.options.subtree, true);
  closeButton.state.display = "block";
  app.observer.notify("attributes");
  assert.equal(app.timeouts.size, 1);
  app.runScheduledScans();
  assert.equal(closeButton.state.clicks, 1);
  assert.equal(app.timeouts.size, 0);
});

test("scans after insertion and batches mutations without delaying the pending scan", async () => {
  const matches = [];
  const closeButton = createElement();
  const app = await startContentScript({
    config: { enabled: true, selectors: [".ad-close"] },
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
      selectors: [".ad-close"],
      cooldown: 8000
    },
    elementsBySelector: { ".ad-close": [hiddenButton, disabledButton, detachedButton] }
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
  assert.equal(app.observer.options.childList, true);
  assert.equal(differentSite.state.clicks, 0);
  assert.equal(otherApp.observer.options, undefined);
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
  assert.equal(app.observer.options, undefined);
  app.storageListeners[0]({ [siteKey]: { newValue: [".ad-close"] } }, "sync");
  assert.equal(closeButton.state.clicks, 1);
  assert.equal(app.observer.options.childList, true);
  app.storageListeners[0]({ [siteKey]: { oldValue: [".ad-close"] } }, "sync");
  assert.equal(app.observer.options, undefined);
});

test("respects the cooldown when an immediate scan is requested twice", async () => {
  const closeButton = createElement();
  const app = await startContentScript({
    config: {
      enabled: true,
      selectors: [".ad-close"],
      cooldown: 8000
    },
    elementsBySelector: { ".ad-close": [closeButton] }
  });

  const response = sendMessage(app.runtimeListeners[0], { type: "scan-now" });

  assert.equal(closeButton.state.clicks, 1);
  assert.deepEqual(toPlainObject(response), { totalClicks: 1 });
});

test("keeps scanning valid selectors when another selector is invalid", async () => {
  const closeButton = createElement();
  await startContentScript({
    config: {
      enabled: true,
      selectors: ["[", ".ad-close"],
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
      selectors: [".ad-close"],
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
