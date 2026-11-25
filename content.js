(() => {
  if (globalThis.selectorClickerContentLoaded) return;
  globalThis.selectorClickerContentLoaded = true;
  const accessPattern = getSiteAccessPattern(location.href);
  const hostname = getSiteHostname(location.href);
  const siteKey = hostname ? siteSelectorsKey(hostname) : null;
  const detailsKey = hostname ? siteRuleDetailsKey(hostname) : null;
  const pausedKey = hostname ? sitePausedKey(hostname) : null;
  const DEFAULTS = {
    enabled: false,
    cooldown: 8000,
    ...(siteKey ? { [siteKey]: [], [detailsKey]: {}, [pausedKey]: false } : {})
  };

  let config = { ...DEFAULTS };
  let mutationTimer = null;
  let totalClicks = 0;
  let siteAuthorized = false;
  let initialized = false;
  let authorizationChanged = false;
  const pendingSettings = {};
  let ruleHighlight;
  let siteRules = [];
  const lastClicks = new WeakMap();
  const ruleClicks = new Map();
  const picker = createElementPicker(async (selector, name, editing) => {
    if (!siteAuthorized) throw new Error("当前站点的访问权限已撤销。");
    const message = editing
      ? { type: "replace-picked-selector", selector: editing.selector, expectedId: editing.id, replacement: selector, name }
      : { type: "save-site-selector", selector, name };
    const response = await chrome.runtime.sendMessage(message);
    if (response?.ok) return;
    const errors = {
      missing: "规则已变更，请重新打开扩展。",
      duplicate: "这个元素已有规则，请选取其他元素。"
    };
    throw new Error(errors[response?.reason] || "保存失败，请重试。");
  }, scheduleScan);

  function isVisible(element) {
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

  function inspectRule(selector) {
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
    if (typeof target.click !== "function" || target.matches(":disabled, [aria-disabled='true']")) {
      return { status: "disabled", target };
    }
    const lastClick = lastClicks.get(target);
    const status = lastClick != null && Date.now() - lastClick < config.cooldown ? "cooldown" : "ready";
    return { status, target };
  }

  function testRule(selector) {
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

  function ruleRestriction(rule) {
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

  function applyConfig(nextConfig, scanImmediately = true) {
    config = {
      ...DEFAULTS,
      ...nextConfig,
      cooldown: Math.max(1000, Number(nextConfig.cooldown) || DEFAULTS.cooldown)
    };
    const hadRules = siteRules.length > 0;
    siteRules = getSiteRules(config, hostname);

    window.clearTimeout(mutationTimer);
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
  window.navigation?.addEventListener("currententrychange", scheduleScan);

  const initialConfig = Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ [AUTHORIZED_SITES_KEY]: [] })
  ]).then(([settings, local]) => {
    if (!authorizationChanged) siteAuthorized = local[AUTHORIZED_SITES_KEY].includes(accessPattern);
    applyConfig({ ...settings, ...pendingSettings });
    initialized = true;
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && Object.hasOwn(changes, AUTHORIZED_SITES_KEY)) {
      authorizationChanged = true;
      siteAuthorized = (changes[AUTHORIZED_SITES_KEY].newValue || []).includes(accessPattern);
      if (!siteAuthorized) {
        picker.stop();
        ruleHighlight?.cancel();
      }
      if (initialized) applyConfig(config);
      return;
    }
    if (areaName !== "sync") return;
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
        return rule.paused !== next.paused || rule.pathPrefix !== next.pathPrefix || rule.maxClicks !== next.maxClicks;
      });
      if (!executionChanged) {
        config = changedConfig;
        siteRules = nextRules;
        return;
      }
      const ruleBecameRunnable = siteRules.some((rule, index) => ruleRestriction(rule) && !ruleRestriction(nextRules[index]));
      applyConfig(changedConfig, ruleBecameRunnable);
      return;
    }
    applyConfig(changedConfig);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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
    if (message.type === "test-rule" && siteAuthorized && message.hostname === hostname) {
      sendResponse(testRule(message.selector));
    }
    if (message.type === "start-picker") {
      const editing = message.selector && siteRules
        .find((rule) => rule.selector === message.selector && rule.id === message.expectedId);
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
