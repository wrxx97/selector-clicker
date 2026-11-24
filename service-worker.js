importScripts("site-rules.js");

const DEFAULTS = {
  enabled: false,
  cooldown: 8000
};

let siteRuleUpdates = Promise.resolve();

function updateSiteSelectors(hostname, selector, remove) {
  const key = siteSelectorsKey(hostname);
  const update = siteRuleUpdates.then(async () => {
    const { [key]: current } = await chrome.storage.sync.get({ [key]: [] });
    const next = remove ? current.filter((rule) => rule !== selector) : [...new Set([...current, selector])];
    if (next.length !== current.length) {
      if (next.length) await chrome.storage.sync.set({ [key]: next });
      else await chrome.storage.sync.remove(key);
    }
    return next;
  });
  siteRuleUpdates = update.catch(() => {});
  return update;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(existing);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "click-record" && sender.tab?.id) {
    const text = String(message.totalClicks || "");
    chrome.action.setBadgeText({ tabId: sender.tab.id, text });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#176f3c" });
  }

  if (message.type === "reset-badge" && sender.tab?.id) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: "" });
  }

  if (message.type === "get-defaults") {
    sendResponse(DEFAULTS);
  }

  if (message.type === "save-site-selector" || message.type === "remove-site-selector") {
    const remove = message.type === "remove-site-selector";
    const hostname = remove ? message.hostname : getSiteHostname(sender.url);
    if (!hostname || typeof message.selector !== "string" || !message.selector.trim()) {
      sendResponse({ ok: false });
      return;
    }
    updateSiteSelectors(hostname, message.selector, remove).then(
      (selectors) => sendResponse({ ok: true, selectors }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});
