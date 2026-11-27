declare var selectorClickerContentLoaded: boolean | undefined;
declare var selectorClickerPicker: typeof import("./picker");
type ContentBrowserClickPoint = import("../lib/extension-types").BrowserClickPoint;
type ContentBrowserClickRequest = Extract<import("../lib/extension-types").WorkerRequest, { type: "browser-click" }>;
type ContentPageResponses = import("../lib/extension-types").PageResponses;
type NativeClickTarget = Element & { click(): void };
type ClickTarget = NativeClickTarget | SVGElement;
type RuleInspection =
  | { status: "ready" | "cooldown"; target: ClickTarget; count?: never }
  | { status: "disabled"; target: Element; count?: never }
  | { status: "ambiguous"; count: number; target?: never }
  | { status: "invalid" | "missing" | "hidden"; count?: never; target?: never };

(() => {
  if (globalThis.selectorClickerContentLoaded) return;
  globalThis.selectorClickerContentLoaded = true;
  const accessPattern = getSiteAccessPattern(location.href);
  const hostname = getSiteHostname(location.href);
  const siteKey = siteSelectorsKey(hostname);
  const hideKey = siteHideRulesKey(hostname);
  const detailsKey = siteRuleDetailsKey(hostname);
  const pausedKey = sitePausedKey(hostname);
  const DEFAULTS: RuntimeStored & { enabled: boolean; cooldown: number } = {
    enabled: false,
    hideEnabled: true,
    cooldown: 8000,
    ...(hostname ? { [siteKey]: [], [detailsKey]: {}, [pausedKey]: false, [hideKey]: [] } : {})
  };

  let config = { ...DEFAULTS };
  let mutationTimer: number | null = null;
  let totalClicks = 0;
  let siteAuthorized = false;
  let initialized = false;
  let authorizationChanged = false;
  let experimentalSettingChanged = false;
  let browserClickEnabled = false;
  let browserClickJob: { rule: RuntimeRule; target: Element; url: string } | undefined;
  let browserClickScan: Promise<void> | undefined;
  let browserScanQueued = false;
  let languageChanged = false;
  const { languageStorageKey: languageKey, normalizePreference, resolveLocale, createElementPicker } = selectorClickerPicker;
  const pendingSettings: RuntimeStored = {};
  let ruleHighlight: Animation | undefined;
  let siteRules: RuntimeRule[] = [];
  let hideRules: RuntimeHideRule[] = [];
  const hiddenElements = new Map<HTMLElement | SVGElement, { value: string; priority: string }>();
  const lastClicks = new WeakMap<Element, number>();
  const lastBrowserAttempts = new WeakMap<Element, number>();
  const ruleClicks = new Map<string, number>();
  const picker = createElementPicker(async (rule, mode, editing) => {
    if (!siteAuthorized) return "pickerAccessRevoked";
    const { selector, name } = rule;
    const message = mode !== "click"
      ? { type: "save-hide-rule", rule }
      : editing
        ? { type: "replace-picked-selector", selector: editing.selector, expectedId: editing.id, replacement: selector, name }
        : { type: "save-site-selector", selector, name };
    const response: import("../lib/extension-types").WorkerResponse | undefined = await chrome.runtime.sendMessage(message);
    if (response?.ok) return;
    if (response?.reason === "missing") return "pickerRuleChanged";
    if (response?.reason === "duplicate") return "pickerDuplicate";
    return "pickerSaveError";
  }, scheduleScan);

  function isVisible(element: Element) {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function hasNativeClick(element: Element): element is NativeClickTarget {
    return "click" in element && typeof element.click === "function";
  }

  function getClickTarget(element: Element): Element {
    if (element.matches("button, a[href], input, select, textarea, summary, label, [onclick]")) return element;
    const buttons = element.querySelectorAll("button");
    if (buttons.length === 1) return buttons[0];
    const visible = [...buttons].filter(isVisible);
    return visible.length === 1 ? visible[0] : element;
  }

  function inspectRule(selector: string): RuleInspection {
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return { status: "invalid" };
    }
    if (!matches.length) return { status: "missing" };
    if (matches.length > 1) return { status: "ambiguous", count: matches.length };
    const [selected] = matches;
    if (!selected.isConnected || !isVisible(selected)) return { status: "hidden" };
    const disabledControl = ":disabled, [aria-disabled='true']";
    if (selected.closest(disabledControl)) return { status: "disabled", target: selected };
    const target = getClickTarget(selected);
    if (target !== selected && (!target.isConnected || !isVisible(target))) return { status: "hidden" };
    if ((target !== selected && target.closest(disabledControl)) || (!hasNativeClick(target) && !(target instanceof SVGElement))) {
      return { status: "disabled", target };
    }
    const lastClick = lastClicks.get(target);
    const status = lastClick != null && Date.now() - lastClick < config.cooldown ? "cooldown" : "ready";
    return { status, target };
  }

  function testRule(selector: string): ContentPageResponses["test-rule"] {
    const rule = siteRules.find((item) => item.selector === selector);
    ruleHighlight?.cancel();
    if (!rule) return { status: "removed" };
    const { status, count, target } = inspectRule(rule.selector);
    if (target) {
      ruleHighlight = target.animate([
        { outline: "3px solid #2978ce", outlineOffset: "3px" },
        { outline: "3px solid transparent", outlineOffset: "5px" }
      ], { duration: 2400, easing: "ease-in" });
    }
    return { status: ruleRestriction(rule) || status, count };
  }

  function ruleRestriction(rule: RuntimeRule) {
    if (rule.paused) return "rule-paused";
    if (rule.pathPrefix) {
      const path = new URL(location.href).pathname;
      if (path !== rule.pathPrefix && !path.startsWith(`${rule.pathPrefix}/`)) return "out-of-scope";
    }
    if (rule.maxClicks && (ruleClicks.get(rule.id) || 0) >= rule.maxClicks) return "limit-reached";
    return "";
  }

  function automaticClickEnabled() {
    return siteAuthorized && config.enabled && siteRules.some((rule) => !rule.paused);
  }

  function automaticHideEnabled() {
    return siteAuthorized && config.hideEnabled === true && hideRules.some((rule) => !rule.paused);
  }

  function isHiddenByExtension(style: CSSStyleDeclaration) {
    return style.getPropertyValue("display") === "none" && style.getPropertyPriority("display") === "important";
  }

  function updateHiddenElements() {
    const hiding = automaticHideEnabled();
    if (!hiding && !hiddenElements.size) return;
    const targets = new Set<HTMLElement | SVGElement>();
    if (hiding) {
      for (const rule of hideRules) {
        if (rule.paused) continue;
        for (const target of findHideTargets(rule)) targets.add(target);
      }
    }

    for (const [element, previous] of hiddenElements) {
      if (targets.has(element)) continue;
      if (isHiddenByExtension(element.style)) {
        if (previous.value) element.style.setProperty("display", previous.value, previous.priority);
        else element.style.removeProperty("display");
      }
      hiddenElements.delete(element);
    }

    for (const element of targets) {
      if (isHiddenByExtension(element.style)) continue;
      hiddenElements.set(element, {
        value: element.style.getPropertyValue("display"),
        priority: element.style.getPropertyPriority("display")
      });
      element.style.setProperty("display", "none", "important");
    }
  }

  function browserClickPoint(target: Element): ContentBrowserClickPoint | null {
    if (document.visibilityState !== "visible") return null;
    for (const rect of target.getClientRects()) {
      const left = Math.max(0, rect.left);
      const top = Math.max(0, rect.top);
      const right = Math.min(document.documentElement.clientWidth, rect.right);
      const bottom = Math.min(document.documentElement.clientHeight, rect.bottom);
      if (right <= left || bottom <= top) continue;
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      if (target.contains(document.elementFromPoint(x, y))) return { x, y };
    }
    return null;
  }

  function prepareBrowserClick(ruleId: unknown): ContentBrowserClickPoint | null {
    const job = browserClickJob;
    if (!job || job.rule.id !== ruleId || job.url !== location.href ||
        !browserClickEnabled || !automaticClickEnabled() || picker.active) return null;
    const rule = siteRules.find((item) => item.id === ruleId);
    if (!rule || rule.selector !== job.rule.selector || ruleRestriction(rule)) return null;
    const { status, target } = inspectRule(rule.selector);
    return status === "ready" && target === job.target ? browserClickPoint(target) : null;
  }

  function recordRuleClick(rule: RuntimeRule) {
    ruleClicks.set(rule.id, (ruleClicks.get(rule.id) || 0) + 1);
    totalClicks += 1;
  }

  async function scanWithBrowserInput() {
    for (const saved of siteRules) {
      if (!browserClickEnabled || !automaticClickEnabled() || picker.active) break;
      const rule = siteRules.find((item) => item.id === saved.id);
      if (!rule || ruleRestriction(rule)) continue;
      const { status, target } = inspectRule(rule.selector);
      if (status !== "ready" || Date.now() - (lastBrowserAttempts.get(target) ?? -Infinity) < config.cooldown ||
          !browserClickPoint(target)) continue;

      lastBrowserAttempts.set(target, Date.now());
      browserClickJob = { rule, target, url: location.href };
      const request: ContentBrowserClickRequest = { type: "browser-click", ruleId: rule.id };
      const result = await chrome.runtime.sendMessage(request).catch(() => undefined);
      browserClickJob = undefined;
      if (result?.ok !== true) continue;

      lastClicks.set(target, Date.now());
      recordRuleClick(rule);
      void chrome.runtime.sendMessage({ type: "click-record", totalClicks, ruleIds: [rule.id] }).catch(() => {});
    }
  }

  function scan() {
    if (picker.active) return;
    updateHiddenElements();
    if (!automaticClickEnabled()) return;
    if (browserClickScan) return browserClickScan;
    if (browserClickEnabled) {
      browserClickScan = scanWithBrowserInput().finally(() => {
        browserClickScan = undefined;
        if (browserScanQueued) {
          browserScanQueued = false;
          scheduleScan();
        }
      });
      return browserClickScan;
    }

    const ruleIds = [];
    for (const rule of siteRules) {
      if (ruleRestriction(rule)) continue;
      const { status, target } = inspectRule(rule.selector);
      if (status !== "ready") continue;
      lastClicks.set(target, Date.now());
      if (hasNativeClick(target)) target.click();
      else target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, view: window }));
      recordRuleClick(rule);
      ruleIds.push(rule.id);
    }
    if (ruleIds.length) {
      chrome.runtime.sendMessage({ type: "click-record", totalClicks, ruleIds });
    }
  }

  function scheduleScan() {
    if ((!automaticClickEnabled() && !automaticHideEnabled()) || picker.active || mutationTimer !== null) return;
    mutationTimer = window.setTimeout(() => {
      mutationTimer = null;
      if (browserClickScan) browserScanQueued = true;
      else scan();
    }, 100);
  }

  function applyConfig(nextConfig: RuntimeStored, scanImmediately = true, hideOnly = false) {
    config = {
      ...DEFAULTS,
      ...nextConfig,
      cooldown: Math.max(1000, Number(nextConfig.cooldown) || DEFAULTS.cooldown)
    };
    const hadRules = siteRules.length > 0;
    siteRules = getSiteRules(config, hostname);
    hideRules = getSiteHideRules(config, hostname);
    const clicking = automaticClickEnabled();
    const hiding = automaticHideEnabled();

    if (!hideOnly || (!clicking && !hiding)) {
      if (mutationTimer !== null) window.clearTimeout(mutationTimer);
      mutationTimer = null;
    }
    if (clicking || hiding) {
      observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        ...(hiding ? { characterData: true } : {})
      });
    } else {
      observer.disconnect();
    }
    if (!hiding || (hideOnly && !picker.active)) updateHiddenElements();
    if (scanImmediately && !hideOnly && (clicking || hiding)) scan();
    if (!hideOnly && !clicking && (!config.enabled || !siteAuthorized || hadRules || siteRules.length)) {
      chrome.runtime.sendMessage({ type: "reset-badge" });
    }
  }

  const observer = new MutationObserver(scheduleScan);
  document.addEventListener("visibilitychange", () => {
    if (browserClickEnabled && document.visibilityState === "visible") scheduleScan();
  });
  (window as Window & { navigation?: EventTarget }).navigation?.addEventListener("currententrychange", scheduleScan);

  const initialConfig = Promise.all([
    chrome.storage.sync.get({ ...DEFAULTS, [languageKey]: "auto" }),
    chrome.storage.local.get({ [AUTHORIZED_SITES_KEY]: [], [BROWSER_CLICK_ENABLED_KEY]: false })
  ]).then(([settings, local]) => {
    if (!authorizationChanged) siteAuthorized = storageStrings(local[AUTHORIZED_SITES_KEY]).includes(accessPattern);
    if (!experimentalSettingChanged) browserClickEnabled = local[BROWSER_CLICK_ENABLED_KEY] === true && supportsBrowserClick();
    if (!languageChanged) picker.setLocale(resolveLocale(normalizePreference(settings[languageKey])));
    applyConfig({ ...settings, ...pendingSettings });
    initialized = true;
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      if (Object.hasOwn(changes, BROWSER_CLICK_ENABLED_KEY)) {
        experimentalSettingChanged = true;
        browserClickEnabled = changes[BROWSER_CLICK_ENABLED_KEY].newValue === true && supportsBrowserClick();
        if (initialized) scheduleScan();
      }
      if (Object.hasOwn(changes, AUTHORIZED_SITES_KEY)) {
        authorizationChanged = true;
        siteAuthorized = storageStrings(changes[AUTHORIZED_SITES_KEY].newValue).includes(accessPattern);
        if (!siteAuthorized) {
          picker.stop();
          ruleHighlight?.cancel();
        }
        if (initialized) applyConfig(config);
      }
      return;
    }
    if (areaName !== "sync") return;
    if (changes[languageKey]) {
      languageChanged = true;
      picker.setLocale(resolveLocale(normalizePreference(changes[languageKey].newValue)));
    }
    const changedKeys = Object.keys(DEFAULTS).filter((key) => Object.hasOwn(changes, key));
    if (!changedKeys.length) return;
    const changedConfig = initialized ? { ...config } : pendingSettings;
    for (const key of changedKeys) {
      changedConfig[key] = changes[key].newValue ?? DEFAULTS[key];
    }
    if (!initialized) return;
    if (changedKeys.length === 1 && changedKeys[0] === detailsKey) {
      const nextRules = getSiteRules(changedConfig, hostname);
      const executionChanged = siteRules.some((rule, index) => {
        const next = nextRules[index];
        return !next || rule.paused !== next.paused || rule.pathPrefix !== next.pathPrefix || rule.maxClicks !== next.maxClicks;
      });
      if (!executionChanged) {
        config = { ...config, ...changedConfig };
        siteRules = nextRules;
        return;
      }
      const ruleBecameRunnable = siteRules.some((rule, index) => nextRules[index] && ruleRestriction(rule) && !ruleRestriction(nextRules[index]));
      applyConfig(changedConfig, ruleBecameRunnable);
      return;
    }
    const hideOnly = changedKeys.every((key) => key === hideKey || key === "hideEnabled");
    applyConfig(changedConfig, true, hideOnly);
  });

  chrome.runtime.onMessage.addListener((payload: unknown, sender, sendResponse) => {
    const message = recordValues(payload);
    if (message.type === "get-status") {
      const status = () => ({
        enabled: config.enabled,
        totalClicks,
        authorized: siteAuthorized
      });
      if (initialized) sendResponse(status());
      else {
        initialConfig.then(() => sendResponse(status()), () => sendResponse({ authorized: false }));
        return true;
      }
    }
    if (message.type === "browser-click-point" && !sender.tab && sender.id === chrome.runtime.id) {
      sendResponse(prepareBrowserClick(message.ruleId));
    }
    if (message.type === "scan-now") {
      const completion = scan();
      if (completion) {
        completion.then(() => sendResponse({ totalClicks }));
        return true;
      }
      sendResponse({ totalClicks });
    }
    if (message.type === "test-rule" && typeof message.selector === "string" && siteAuthorized && message.hostname === hostname) {
      sendResponse(testRule(message.selector));
    }
    if (message.type === "start-picker") {
      const editing = typeof message.selector === "string" && message.selector ? siteRules
        .find((rule) => rule.selector === message.selector && rule.id === message.expectedId) : undefined;
      if (!siteAuthorized || !hostname || message.hostname !== hostname || (message.selector && !editing)) {
        sendResponse({ ok: false });
        return;
      }
      try {
        const mode = message.mode === "hide-element" || message.mode === "hide-containing" ? message.mode : "click";
        picker.start(hostname, editing, mode);
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    }
  });
})();
