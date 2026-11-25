(() => {
  const hostname = getSiteHostname(location.href);
  const siteKey = hostname ? siteSelectorsKey(hostname) : null;
  const detailsKey = hostname ? siteRuleDetailsKey(hostname) : null;
  const DEFAULTS = {
    enabled: false,
    cooldown: 8000,
    ...(siteKey ? { [siteKey]: [], [detailsKey]: {} } : {})
  };

  let config = { ...DEFAULTS };
  let mutationTimer = null;
  let totalClicks = 0;
  let ruleHighlight;
  const lastClicks = new WeakMap();
  const picker = createElementPicker(async (selector, name, editing) => {
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
    const rule = getSiteRules(config, hostname).find((item) => item.selector === selector);
    ruleHighlight?.cancel();
    if (!rule) return { status: "removed" };
    const { status, count, target } = inspectRule(rule.selector);
    if (target) {
      ruleHighlight = target.animate([
        { outline: "3px solid #2978ce", outlineOffset: "3px" },
        { outline: "3px solid transparent", outlineOffset: "5px" }
      ], { duration: 2400, easing: "ease-in" });
    }
    return { status, count };
  }

  function scan() {
    if (!config.enabled || !siteKey || picker.active) return;

    const ruleIds = [];
    for (const { selector, id } of getSiteRules(config, hostname)) {
      const { status, target } = inspectRule(selector);
      if (status !== "ready") continue;
      lastClicks.set(target, Date.now());
      target.click();
      totalClicks += 1;
      ruleIds.push(id);
    }
    if (ruleIds.length) {
      chrome.runtime.sendMessage({ type: "click-record", totalClicks, ruleIds });
    }
  }

  function scheduleScan() {
    if (!config.enabled || !config[siteKey]?.length || picker.active || mutationTimer !== null) return;
    mutationTimer = window.setTimeout(() => {
      mutationTimer = null;
      scan();
    }, 100);
  }

  function applyConfig(nextConfig) {
    config = {
      ...DEFAULTS,
      ...nextConfig,
      cooldown: Math.max(1000, Number(nextConfig.cooldown) || DEFAULTS.cooldown)
    };

    window.clearTimeout(mutationTimer);
    mutationTimer = null;
    if (config.enabled && config[siteKey]?.length) {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      scan();
    } else {
      observer.disconnect();
      if (!config.enabled) chrome.runtime.sendMessage({ type: "reset-badge" });
    }
  }

  const observer = new MutationObserver(scheduleScan);

  chrome.storage.sync.get(DEFAULTS).then(applyConfig);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    const changedKeys = Object.keys(DEFAULTS).filter((key) => Object.hasOwn(changes, key));
    if (!changedKeys.length) return;
    const changedConfig = { ...config };
    for (const key of changedKeys) {
      changedConfig[key] = changes[key].newValue ?? DEFAULTS[key];
    }
    if (changedKeys.length === 1 && changedKeys[0] === detailsKey) {
      config = changedConfig;
      return;
    }
    applyConfig(changedConfig);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "get-status") {
      sendResponse({
        enabled: config.enabled,
        totalClicks
      });
    }
    if (message.type === "scan-now") {
      scan();
      sendResponse({ totalClicks });
    }
    if (message.type === "test-rule" && message.hostname === hostname) {
      sendResponse(testRule(message.selector));
    }
    if (message.type === "start-picker") {
      const editing = message.selector && getSiteRules(config, hostname)
        .find((rule) => rule.selector === message.selector && rule.id === message.expectedId);
      if (!hostname || message.hostname !== hostname || (message.selector && !editing)) {
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
