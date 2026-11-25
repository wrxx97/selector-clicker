importScripts("site-rules.js");

const DEFAULTS = {
  enabled: false,
  cooldown: 8000
};

let siteRuleUpdates = Promise.resolve();
let clickStatsUpdates = Promise.resolve();
let siteAccessUpdates = Promise.resolve();
const SITE_SCRIPT_ID = "selector-clicker-sites";

function updateSiteAccess(granted = []) {
  const update = siteAccessUpdates.then(async () => {
    const { [AUTHORIZED_SITES_KEY]: previous } = await chrome.storage.local.get({ [AUTHORIZED_SITES_KEY]: [] });
    const exactOrigins = [...new Set([...previous, ...granted])].filter((pattern) =>
      pattern && pattern === getSiteAccessPattern(pattern));
    const checks = await Promise.all(exactOrigins.map((pattern) => chrome.permissions.contains({ origins: [pattern] })));
    const matches = exactOrigins.filter((_pattern, index) => checks[index]).sort();
    if (JSON.stringify(previous) !== JSON.stringify(matches)) {
      // Revocation must also stop scripts already present in open documents.
      await chrome.storage.local.set({ [AUTHORIZED_SITES_KEY]: matches });
    }
    const [current] = await chrome.scripting.getRegisteredContentScripts({ ids: [SITE_SCRIPT_ID] });
    if (!matches.length) {
      if (current) await chrome.scripting.unregisterContentScripts({ ids: [SITE_SCRIPT_ID] });
    } else if (!current) {
      await chrome.scripting.registerContentScripts([{
        id: SITE_SCRIPT_ID, matches, js: SITE_SCRIPT_FILES, runAt: "document_idle", persistAcrossSessions: true
      }]);
    } else if (JSON.stringify([...current.matches].sort()) !== JSON.stringify(matches)) {
      await chrome.scripting.updateContentScripts([{ id: SITE_SCRIPT_ID, matches }]);
    }
    return matches;
  });
  siteAccessUpdates = update.catch(() => {});
  return update;
}

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
  const countsKey = siteClickCountsKey(hostname);
  const timesKey = siteLastClickTimesKey(hostname);
  const clickedAt = Date.now();
  const update = clickStatsUpdates.then(async () => {
    const { [countsKey]: currentCounts, [timesKey]: currentTimes, [TOTAL_CLICK_COUNT_KEY]: total } = await chrome.storage.local.get({
      [countsKey]: {},
      [timesKey]: {},
      [TOTAL_CLICK_COUNT_KEY]: 0
    });
    const counts = { ...currentCounts };
    const times = { ...currentTimes };
    for (const id of ruleIds) {
      const key = `rule:${id}`;
      counts[key] = (counts[key] || 0) + 1;
      times[key] = Math.max(times[key] || 0, clickedAt);
    }
    await chrome.storage.local.set({
      [countsKey]: counts,
      [timesKey]: times,
      [TOTAL_CLICK_COUNT_KEY]: total + ruleIds.length
    });
  });
  clickStatsUpdates = update.catch(() => {});
  return update;
}

function importRules(backup) {
  const update = siteRuleUpdates.then(async () => {
    const sites = parseRuleBackup(backup);
    const defaults = {};
    for (const { hostname } of sites) {
      defaults[siteSelectorsKey(hostname)] = [];
      defaults[siteRuleDetailsKey(hostname)] = {};
    }
    const stored = await chrome.storage.sync.get(defaults);
    const changes = {};
    let addedCount = 0;
    let duplicateCount = 0;
    for (const { hostname, paused, existing, added, duplicates } of planRuleImport(stored, sites)) {
      addedCount += added.length;
      duplicateCount += duplicates;
      if (!added.length) continue;
      const selectorsKey = siteSelectorsKey(hostname);
      const detailsKey = siteRuleDetailsKey(hostname);
      changes[selectorsKey] = [...existing.map((rule) => rule.selector), ...added.map((rule) => rule.selector)];
      changes[detailsKey] = { ...stored[detailsKey] };
      for (const { selector, ...details } of added) {
        changes[detailsKey][ruleSelectorKey(selector)] = { ...details, id: crypto.randomUUID() };
      }
      if (!existing.length && paused) changes[sitePausedKey(hostname)] = true;
    }
    if (addedCount) await chrome.storage.sync.set(changes);
    return { ok: true, addedCount, duplicateCount };
  });
  siteRuleUpdates = update.catch(() => {});
  return update;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(existing);
  await updateSiteAccess().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => updateSiteAccess().catch(() => {}));
chrome.permissions.onAdded.addListener(({ origins }) => updateSiteAccess(origins).catch(() => {}));
chrome.permissions.onRemoved.addListener(() => updateSiteAccess().catch(() => {}));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "authorize-site") {
    if (sender.url !== chrome.runtime.getURL("popup.html")) return;
    const { pattern } = message;
    if (typeof pattern !== "string" || !pattern || pattern !== getSiteAccessPattern(pattern)) {
      sendResponse({ ok: false });
      return;
    }
    updateSiteAccess([pattern]).then(
      (matches) => sendResponse({ ok: matches.includes(pattern) }),
      () => sendResponse({ ok: false })
    );
    return true;
  }
  if (message.type === "import-rules") {
    if (sender.url !== chrome.runtime.getURL("rules.html")) return;
    importRules(message.backup).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
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
