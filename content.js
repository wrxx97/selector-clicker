(() => {
  const hostname = getSiteHostname(location.href);
  const siteKey = hostname ? siteSelectorsKey(hostname) : null;
  const DEFAULTS = {
    enabled: false,
    selectors: [],
    cooldown: 8000,
    ...(siteKey ? { [siteKey]: [] } : {})
  };

  let config = { ...DEFAULTS };
  let mutationTimer = null;
  let totalClicks = 0;
  const lastClicks = new WeakMap();
  const picker = createElementPicker(async (selector) => {
    const response = await chrome.runtime.sendMessage({ type: "save-site-selector", selector });
    if (!response?.ok) throw new Error("Could not save site rule");
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

  function canClick(element) {
    if (!element.isConnected || !isVisible(element)) return false;
    if (element.matches("[disabled], [aria-disabled='true']")) return false;

    const lastClick = lastClicks.get(element) || 0;
    return Date.now() - lastClick >= config.cooldown;
  }

  function clickElement(element, selector) {
    if (!canClick(element)) return false;

    lastClicks.set(element, Date.now());
    element.click();
    totalClicks += 1;
    chrome.runtime.sendMessage({
      type: "click-record",
      totalClicks,
      selector
    });
    return true;
  }

  function scanSelectors(selectors, uniqueOnly = false) {
    for (const selector of selectors) {
      try {
        const matches = document.querySelectorAll(selector);
        if (uniqueOnly && matches.length !== 1) continue;
        for (const element of matches) {
          clickElement(element, selector);
        }
      } catch {
        // Invalid selectors are shown in the extension popup and skipped here.
      }
    }
  }

  function scan() {
    if (!config.enabled || picker.active) return;
    scanSelectors(config.selectors);
    if (siteKey) scanSelectors(config[siteKey], true);
  }

  function scheduleScan() {
    if (!config.enabled || picker.active || mutationTimer !== null) return;
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
    if (config.enabled && (config.selectors.length || config[siteKey]?.length)) {
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
    applyConfig(changedConfig);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "get-status") {
      sendResponse({
        enabled: config.enabled,
        totalClicks,
        selectors: config.selectors
      });
    }
    if (message.type === "scan-now") {
      scan();
      sendResponse({ totalClicks });
    }
    if (message.type === "start-picker") {
      if (!hostname) {
        sendResponse({ ok: false });
        return;
      }
      try {
        picker.start(hostname);
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    }
  });
})();
