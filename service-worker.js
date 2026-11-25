importScripts("site-rules.js");

const DEFAULTS = {
  enabled: false,
  cooldown: 8000
};

let siteRuleUpdates = Promise.resolve();
let clickStatsUpdates = Promise.resolve();

function updateSiteSelectors(hostname, { type, selector, replacement, name, expectedId, paused, execution }) {
  const key = siteSelectorsKey(hostname);
  const detailsKey = siteRuleDetailsKey(hostname);
  const update = siteRuleUpdates.then(async () => {
    const { [key]: current, [detailsKey]: currentDetails } = await chrome.storage.sync.get({
      [key]: [],
      [detailsKey]: {}
    });
    const index = current.indexOf(selector);
    const selectorKey = ruleSelectorKey(selector);
    const existing = currentDetails[selectorKey];
    let next = current;
    let details = currentDetails;

    switch (type) {
      case "save-site-selector":
        if (index === -1) {
          next = [...current, selector];
          details = { ...currentDetails, [selectorKey]: { id: crypto.randomUUID(), name: name || "" } };
        } else if (name && name !== existing?.name) {
          details = { ...currentDetails, [selectorKey]: { ...existing, id: existing?.id || selectorKey, name } };
        }
        break;
      case "remove-site-selector":
        if (index !== -1) {
          next = current.filter((rule) => rule !== selector);
          if (existing) {
            details = { ...currentDetails };
            delete details[selectorKey];
          }
        }
        break;
      case "edit-site-selector":
        if (index === -1 || (expectedId && expectedId !== (existing?.id || selectorKey))) {
          return { ok: false, reason: "missing" };
        }
        if (selector !== replacement) {
          if (current.includes(replacement)) return { ok: false, reason: "duplicate" };
          next = current.slice();
          next[index] = replacement;
        } else if (!execution && (name == null || name === (existing?.name || ""))) {
          break;
        }
        details = { ...currentDetails };
        delete details[selectorKey];
        details[ruleSelectorKey(replacement)] = {
          ...existing,
          id: existing?.id || selectorKey,
          name: name ?? existing?.name ?? "",
          ...execution
        };
        break;
      case "set-rule-paused":
        if (index === -1 || expectedId !== (existing?.id || selectorKey)) {
          return { ok: false, reason: "missing" };
        }
        if (paused === (existing?.paused === true)) break;
        details = {
          ...currentDetails,
          [selectorKey]: { ...existing, id: expectedId, name: existing?.name || "", paused }
        };
        break;
    }

    if (next !== current || details !== currentDetails) {
      if (!next.length) {
        await chrome.storage.sync.remove([key, detailsKey]);
      } else {
        const changes = {};
        if (next !== current) changes[key] = next;
        if (details !== currentDetails) changes[detailsKey] = details;
        await chrome.storage.sync.set(changes);
      }
    }
    return { ok: true, selectors: next };
  });
  siteRuleUpdates = update.catch(() => {});
  return update;
}

function recordClickStats(hostname, ruleIds) {
  const siteKey = siteClickCountsKey(hostname);
  const update = clickStatsUpdates.then(async () => {
    const { [siteKey]: currentCounts, [TOTAL_CLICK_COUNT_KEY]: total } = await chrome.storage.local.get({
      [siteKey]: {},
      [TOTAL_CLICK_COUNT_KEY]: 0
    });
    const counts = { ...currentCounts };
    for (const id of ruleIds) {
      const key = `rule:${id}`;
      counts[key] = (counts[key] || 0) + 1;
    }
    await chrome.storage.local.set({
      [siteKey]: counts,
      [TOTAL_CLICK_COUNT_KEY]: total + ruleIds.length
    });
  });
  clickStatsUpdates = update.catch(() => {});
  return update;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(existing);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "click-record" && sender.tab?.id != null) {
    const text = String(message.totalClicks || "");
    chrome.action.setBadgeText({ tabId: sender.tab.id, text });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#176f3c" });
    const hostname = getSiteHostname(sender.url);
    const ruleIds = Array.isArray(message.ruleIds)
      ? message.ruleIds.filter((id) => typeof id === "string" && id)
      : [];
    if (!hostname || !ruleIds.length) return;
    recordClickStats(hostname, ruleIds).then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false })
    );
    return true;
  }

  if (message.type === "reset-badge" && sender.tab?.id) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: "" });
  }

  if (message.type === "get-defaults") {
    sendResponse(DEFAULTS);
  }

  const { type: messageType, selector, expectedId } = message;
  const isPickedReplacement = messageType === "replace-picked-selector";
  const type = isPickedReplacement ? "edit-site-selector" : messageType;
  if (!["save-site-selector", "remove-site-selector", "edit-site-selector", "set-rule-paused", "set-site-paused"].includes(type)) return;

  const hostname = type === "save-site-selector" || isPickedReplacement ? getSiteHostname(sender.url) : message.hostname;
  if (!hostname || getSiteHostname(`https://${hostname}`) !== hostname) {
    sendResponse({ ok: false });
    return;
  }
  const { paused } = message;
  if (type === "set-site-paused") {
    if (typeof paused !== "boolean") {
      sendResponse({ ok: false });
      return;
    }
    const key = sitePausedKey(hostname);
    const update = siteRuleUpdates.then(() => paused ? chrome.storage.sync.set({ [key]: true }) : chrome.storage.sync.remove(key));
    siteRuleUpdates = update.catch(() => {});
    update.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  const replacement = typeof message.replacement === "string" ? message.replacement : "";
  const name = typeof message.name === "string" ? message.name.trim().slice(0, RULE_NAME_MAX_LENGTH) : undefined;
  const hasExecution = type === "edit-site-selector" && (message.pathPrefix !== undefined || message.maxClicks !== undefined);
  const execution = hasExecution ? getExecutionOptions(message.pathPrefix, message.maxClicks) : undefined;
  if (typeof selector !== "string" || !selector.trim() || (type === "edit-site-selector" && !replacement.trim()) ||
      (hasExecution && !execution) ||
      (isPickedReplacement && (typeof expectedId !== "string" || !expectedId)) ||
      (type === "set-rule-paused" && (typeof paused !== "boolean" || typeof expectedId !== "string" || !expectedId))) {
    sendResponse({ ok: false });
    return;
  }
  updateSiteSelectors(hostname, { type, selector, replacement, name, expectedId, paused, execution }).then(
    sendResponse,
    () => sendResponse({ ok: false })
  );
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});
