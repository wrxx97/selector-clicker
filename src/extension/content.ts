declare var selectorClickerContentLoaded: boolean | undefined;
declare var selectorClickerPicker: typeof import("./picker");
type ContentPageResponses = import("../lib/extension-types").PageResponses;
type ClickTarget = Element & { click(): void };
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
  const detailsKey = siteRuleDetailsKey(hostname);
  const pausedKey = sitePausedKey(hostname);
  const DEFAULTS: RuntimeStored & { enabled: boolean; cooldown: number } = {
    enabled: false,
    cooldown: 8000,
    ...(hostname ? { [siteKey]: [], [detailsKey]: {}, [pausedKey]: false } : {})
  };

  let config = { ...DEFAULTS };
  let mutationTimer: number | null = null;
  let totalClicks = 0;
  let siteAuthorized = false;
  let initialized = false;
  let authorizationChanged = false;
  let languageChanged = false;
  const { languageStorageKey: languageKey, normalizePreference, resolveLocale, createElementPicker } = selectorClickerPicker;
  const pendingSettings: RuntimeStored = {};
  let ruleHighlight: Animation | undefined;
  let siteRules: RuntimeRule[] = [];
  const lastClicks = new WeakMap<Element, number>();
  const ruleClicks = new Map<string, number>();
  const picker = createElementPicker(async (selector, name, editing) => {
    if (!siteAuthorized) return "pickerAccessRevoked";
    const message = editing
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

  function inspectRule(selector: string): RuleInspection {
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      return { status: "invalid" };
    }
    if (!matches.length) return { status: "missing" };
    if (matches.length > 1) return { status: "ambiguous", count: matches.length };
    const [target] = matches;
    if (!target.isConnected || !isVisible(target)) return { status: "hidden" };
    if (!("click" in target) || typeof target.click !== "function" || target.matches(":disabled, [aria-disabled='true']")) {
      return { status: "disabled", target };
    }
    const lastClick = lastClicks.get(target);
    const status = lastClick != null && Date.now() - lastClick < config.cooldown ? "cooldown" : "ready";
    return { status, target: target as ClickTarget };
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

  function scan() {
    if (!automaticClickEnabled() || picker.active) return;

    const ruleIds = [];
    for (const rule of siteRules) {
      if (ruleRestriction(rule)) continue;
      const { status, target } = inspectRule(rule.selector);
      if (status !== "ready") continue;
      lastClicks.set(target, Date.now());
      target.click();
      ruleClicks.set(rule.id, (ruleClicks.get(rule.id) || 0) + 1);
      totalClicks += 1;
      ruleIds.push(rule.id);
    }
    if (ruleIds.length) {
      chrome.runtime.sendMessage({ type: "click-record", totalClicks, ruleIds });
    }
  }

  function scheduleScan() {
    if (!automaticClickEnabled() || picker.active || mutationTimer !== null) return;
    mutationTimer = window.setTimeout(() => {
      mutationTimer = null;
      scan();
    }, 100);
  }

  function applyConfig(nextConfig: RuntimeStored, scanImmediately = true) {
    config = {
      ...DEFAULTS,
      ...nextConfig,
      cooldown: Math.max(1000, Number(nextConfig.cooldown) || DEFAULTS.cooldown)
    };
    const hadRules = siteRules.length > 0;
    siteRules = getSiteRules(config, hostname);

    if (mutationTimer !== null) window.clearTimeout(mutationTimer);
    mutationTimer = null;
    if (automaticClickEnabled()) {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      if (scanImmediately) scan();
    } else {
      observer.disconnect();
      if (!config.enabled || !siteAuthorized || hadRules || siteRules.length) chrome.runtime.sendMessage({ type: "reset-badge" });
    }
  }

  const observer = new MutationObserver(scheduleScan);
  (window as Window & { navigation?: EventTarget }).navigation?.addEventListener("currententrychange", scheduleScan);

  const initialConfig = Promise.all([
    chrome.storage.sync.get({ ...DEFAULTS, [languageKey]: "auto" }),
    chrome.storage.local.get({ [AUTHORIZED_SITES_KEY]: [] })
  ]).then(([settings, local]) => {
    if (!authorizationChanged) siteAuthorized = storageStrings(local[AUTHORIZED_SITES_KEY]).includes(accessPattern);
    if (!languageChanged) picker.setLocale(resolveLocale(normalizePreference(settings[languageKey])));
    applyConfig({ ...settings, ...pendingSettings });
    initialized = true;
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.hasOwn(changes, AUTHORIZED_SITES_KEY)) {
      authorizationChanged = true;
      siteAuthorized = storageStrings(changes[AUTHORIZED_SITES_KEY].newValue).includes(accessPattern);
      if (!siteAuthorized) {
        picker.stop();
        ruleHighlight?.cancel();
      }
      if (initialized) applyConfig(config);
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
    applyConfig(changedConfig);
  });

  chrome.runtime.onMessage.addListener((payload: unknown, _sender, sendResponse) => {
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
    if (message.type === "scan-now") {
      scan();
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
        picker.start(hostname, editing);
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    }
  });
})();
