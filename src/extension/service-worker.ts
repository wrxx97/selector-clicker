declare function importScripts(...urls: string[]): void;

importScripts("site-rules.js");

const DEFAULTS = {
  enabled: false,
  cooldown: 8000
};

let siteRuleUpdates: Promise<unknown> = Promise.resolve();
let clickStatsUpdates = Promise.resolve();
let siteAccessUpdates: Promise<unknown> = Promise.resolve();
let toolbarIconUpdates = Promise.resolve();
const SITE_SCRIPT_ID = "selector-clicker-sites";
const toolbarThemes = new Set(["lavender", "rose", "amber", "night"]);

function updateToolbarIcon() {
  const update = toolbarIconUpdates.then(async () => {
    const { uiTheme } = await chrome.storage.sync.get({ uiTheme: "sky" });
    const suffix = typeof uiTheme === "string" && toolbarThemes.has(uiTheme) ? uiTheme + "-" : "";
    const path = Object.fromEntries([16, 24, 32].map((size) => [size, `icons/icon-${suffix}${size}.png`]));
    await chrome.action.setIcon({ path });
  });
  toolbarIconUpdates = update.catch(() => {});
  return update;
}

function updateSiteAccess(granted: string[] = []) {
  const update = siteAccessUpdates.then(async () => {
    const { [AUTHORIZED_SITES_KEY]: stored } = await chrome.storage.local.get({ [AUTHORIZED_SITES_KEY]: [] });
    const previous = storageStrings(stored);
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
    } else if (JSON.stringify([...(current.matches ?? [])].sort()) !== JSON.stringify(matches)) {
      await chrome.scripting.updateContentScripts([{ id: SITE_SCRIPT_ID, matches, js: SITE_SCRIPT_FILES }]);
    }
    return matches;
  });
  siteAccessUpdates = update.catch(() => {});
  return update;
}

function withRulePause(details: RuntimeRuleDetails, selectors: string[], paused: boolean) {
  let updated = details;
  for (const selector of selectors) {
    if (typeof selector !== "string" || !selector.trim()) continue;
    const key = ruleSelectorKey(selector);
    const existing = details[key];
    if (paused === (existing?.paused === true)) continue;
    if (updated === details) updated = { ...details };
    updated[key] = { ...existing, id: existing?.id || key, name: existing?.name || "", paused };
  }
  return updated;
}

type SelectorUpdate =
  | { type: "save-site-selector"; selector: string; name?: string }
  | { type: "remove-site-selector"; selector: string }
  | { type: "edit-site-selector"; selector: string; replacement: string; name?: string; expectedId?: string; execution?: RuntimeExecution }
  | { type: "set-rule-paused"; selector: string; expectedId: string; paused: boolean }
  | { type: "set-site-paused"; paused: boolean };

function updateSiteSelectors(hostname: string, request: SelectorUpdate) {
  const { type } = request;
  const selector = "selector" in request ? request.selector : "";
  const key = siteSelectorsKey(hostname);
  const detailsKey = siteRuleDetailsKey(hostname);
  const pausedKey = sitePausedKey(hostname);
  const update = siteRuleUpdates.then(async () => {
    const stored = await chrome.storage.sync.get({
      [key]: [],
      [detailsKey]: {},
      [pausedKey]: false
    });
    const current = storageStrings(stored[key]);
    const currentDetails = ruleDetails(stored[detailsKey]);
    const hadLegacyPause = stored[pausedKey] === true;
    let details = hadLegacyPause ? withRulePause(currentDetails, current, true) : currentDetails;
    const index = current.indexOf(selector);
    const selectorKey = ruleSelectorKey(selector);
    const existing = details[selectorKey];
    let next = current;

    switch (type) {
      case "save-site-selector": {
        const { name } = request;
        if (index === -1) {
          next = [...current, selector];
          details = { ...details, [selectorKey]: { id: crypto.randomUUID(), name: name || "" } };
        } else if (name && name !== existing?.name) {
          details = { ...details, [selectorKey]: { ...existing, id: existing?.id || selectorKey, name } };
        }
        break;
      }
      case "remove-site-selector":
        if (index !== -1) {
          next = current.filter((rule) => rule !== selector);
          if (existing) {
            details = { ...details };
            delete details[selectorKey];
          }
        }
        break;
      case "edit-site-selector": {
        const { replacement, name, expectedId, execution } = request;
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
        details = { ...details };
        delete details[selectorKey];
        details[ruleSelectorKey(replacement)] = {
          ...existing,
          id: existing?.id || selectorKey,
          name: name ?? existing?.name ?? "",
          ...execution
        };
        break;
      }
      case "set-rule-paused": {
        const { expectedId, paused } = request;
        if (index === -1 || expectedId !== (existing?.id || selectorKey)) {
          return { ok: false, reason: "missing" };
        }
        details = withRulePause(details, [selector], paused);
        break;
      }
      case "set-site-paused":
        details = withRulePause(details, current, request.paused);
        break;
    }

    if (next !== current || details !== currentDetails || hadLegacyPause) {
      if (!next.length) {
        await chrome.storage.sync.remove([key, detailsKey, pausedKey]);
      } else {
        const changes: RuntimeStored = {};
        if (next !== current) changes[key] = next;
        if (details !== currentDetails) changes[detailsKey] = details;
        // Write both keys together so readers never see the legacy pause lifted before its rules are saved.
        if (hadLegacyPause) changes[pausedKey] = false;
        await chrome.storage.sync.set(changes);
      }
    }
    return { ok: true, selectors: next };
  });
  siteRuleUpdates = update.catch(() => {});
  return update;
}

function recordClickStats(hostname: string, ruleIds: string[]) {
  const countsKey = siteClickCountsKey(hostname);
  const timesKey = siteLastClickTimesKey(hostname);
  const clickedAt = Date.now();
  const update = clickStatsUpdates.then(async () => {
    const { [countsKey]: currentCounts, [timesKey]: currentTimes, [TOTAL_CLICK_COUNT_KEY]: total } = await chrome.storage.local.get({
      [countsKey]: {},
      [timesKey]: {},
      [TOTAL_CLICK_COUNT_KEY]: 0
    });
    const counts = { ...recordValues(currentCounts) };
    const times = { ...recordValues(currentTimes) };
    for (const id of ruleIds) {
      const key = `rule:${id}`;
      const count = counts[key];
      const time = times[key];
      counts[key] = (typeof count === "number" ? count : 0) + 1;
      times[key] = Math.max(typeof time === "number" ? time : 0, clickedAt);
    }
    await chrome.storage.local.set({
      [countsKey]: counts,
      [timesKey]: times,
      [TOTAL_CLICK_COUNT_KEY]: (typeof total === "number" ? total : 0) + ruleIds.length
    });
  });
  clickStatsUpdates = update.catch(() => {});
  return update;
}

function copySiteStats(hostname: string, destination: string, rules: RuntimeRule[]) {
  const update = clickStatsUpdates.then(async () => {
    const sourceCounts = siteClickCountsKey(hostname);
    const sourceTimes = siteLastClickTimesKey(hostname);
    const targetCounts = siteClickCountsKey(destination);
    const targetTimes = siteLastClickTimesKey(destination);
    const stored = await chrome.storage.local.get({
      [sourceCounts]: {}, [sourceTimes]: {}, [targetCounts]: {}, [targetTimes]: {}
    });
    const changes: RuntimeStored = {};
    for (const [from, to] of [[sourceCounts, targetCounts], [sourceTimes, targetTimes]]) {
      const source = recordValues(stored[from]);
      const updated = { ...recordValues(stored[to]) };
      for (const { id } of rules) {
        const key = `rule:${id}`;
        const value = source[key];
        if (updated[key] === value) continue;
        if (value === undefined) delete updated[key];
        else updated[key] = value;
        changes[to] = updated;
      }
    }
    if (Object.keys(changes).length) await chrome.storage.local.set(changes);
  });
  clickStatsUpdates = update.catch(() => {});
  return update;
}

function updateSiteGroup({ hostname, destination, expectedRuleIds, type }: {
  hostname: string;
  destination?: unknown;
  expectedRuleIds: string[];
  type: "rename-site" | "remove-site-rules";
}) {
  const selectors = siteSelectorsKey(hostname);
  const details = siteRuleDetailsKey(hostname);
  const paused = sitePausedKey(hostname);
  const update = siteRuleUpdates.then(async () => {
    const target = type === "rename-site" ? normalizeSiteHostname(destination) : "";
    if (type === "rename-site" && (!target || target === hostname)) return { ok: false, reason: "invalid" };
    const targetSelectors = siteSelectorsKey(target);
    const stored = await chrome.storage.sync.get({
      [selectors]: [], [details]: {}, [paused]: false, ...(target ? { [targetSelectors]: [] } : {})
    });
    const rules = getSiteRules(stored, hostname);
    if (!rules.length || rules.length !== expectedRuleIds.length ||
        rules.some((rule, index) => rule.id !== expectedRuleIds[index])) {
      return { ok: false, reason: "changed" };
    }
    if (!target) {
      await chrome.storage.sync.remove([selectors, details, paused]);
      return { ok: true };
    }
    if (getSiteRules(stored, target).length) return { ok: false, reason: "duplicate" };

    // Copy local history before publishing the move so a failed copy leaves the source rules intact.
    await copySiteStats(hostname, target, rules);
    await chrome.storage.sync.set({
      [targetSelectors]: stored[selectors],
      [siteRuleDetailsKey(target)]: stored[details],
      [sitePausedKey(target)]: stored[paused] === true,
      [selectors]: [], [details]: {}, [paused]: false
    });
    return { ok: true };
  });
  siteRuleUpdates = update.catch(() => {});
  return update;
}

function importRules(backup: unknown) {
  const update = siteRuleUpdates.then(async () => {
    const sites = parseRuleBackup(backup);
    const defaults: RuntimeStored = {};
    for (const { hostname } of sites) {
      defaults[siteSelectorsKey(hostname)] = [];
      defaults[siteRuleDetailsKey(hostname)] = {};
      defaults[sitePausedKey(hostname)] = false;
    }
    const stored = await chrome.storage.sync.get(defaults);
    const changes: RuntimeStored = {};
    let addedCount = 0;
    let duplicateCount = 0;
    for (const { hostname, existing, added, duplicates } of planRuleImport(stored, sites)) {
      addedCount += added.length;
      duplicateCount += duplicates;
      if (!added.length) continue;
      const selectorsKey = siteSelectorsKey(hostname);
      const detailsKey = siteRuleDetailsKey(hostname);
      const pausedKey = sitePausedKey(hostname);
      const existingSelectors = existing.map((rule) => rule.selector);
      const existingDetails = ruleDetails(stored[detailsKey]);
      const updatedDetails = stored[pausedKey] === true
        ? { ...withRulePause(existingDetails, existingSelectors, true) } : { ...existingDetails };
      changes[selectorsKey] = [...existingSelectors, ...added.map((rule) => rule.selector)];
      changes[detailsKey] = updatedDetails;
      if (stored[pausedKey] === true) changes[pausedKey] = false;
      for (const { selector, ...details } of added) {
        updatedDetails[ruleSelectorKey(selector)] = { ...details, id: crypto.randomUUID() };
      }
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
  await Promise.allSettled([updateSiteAccess(), updateToolbarIcon()]);
});

chrome.runtime.onStartup.addListener(() => Promise.allSettled([updateSiteAccess(), updateToolbarIcon()]));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.uiTheme) return updateToolbarIcon().catch(() => {});
});
chrome.permissions.onAdded.addListener(({ origins }) => updateSiteAccess(origins).catch(() => {}));
chrome.permissions.onRemoved.addListener(() => updateSiteAccess().catch(() => {}));

chrome.runtime.onMessage.addListener((payload: unknown, sender, sendResponse) => {
  const message = recordValues(payload);
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
  if (message.type === "rename-site" || message.type === "remove-site-rules") {
    const { hostname, expectedRuleIds } = message;
    if (sender.url !== chrome.runtime.getURL("rules.html") || !hostname ||
        normalizeSiteHostname(hostname) !== hostname || !Array.isArray(expectedRuleIds) ||
        !expectedRuleIds.every((id) => typeof id === "string" && id)) {
      sendResponse({ ok: false });
      return;
    }
    updateSiteGroup({ type: message.type, hostname, destination: message.destination, expectedRuleIds }).then(sendResponse, () => sendResponse({ ok: false }));
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
  if (type !== "save-site-selector" && type !== "remove-site-selector" && type !== "edit-site-selector" &&
      type !== "set-rule-paused" && type !== "set-site-paused") return;

  const hostname = type === "save-site-selector" || isPickedReplacement ? getSiteHostname(sender.url) : message.hostname;
  if (typeof hostname !== "string" || !hostname || getSiteHostname(`https://${hostname}`) !== hostname) {
    sendResponse({ ok: false });
    return;
  }
  const { paused } = message;
  if (type === "set-site-paused") {
    if (typeof paused !== "boolean") {
      sendResponse({ ok: false });
      return;
    }
    updateSiteSelectors(hostname, { type, paused }).then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  const replacement = typeof message.replacement === "string" ? message.replacement : "";
  const name = typeof message.name === "string" ? message.name.trim().slice(0, RULE_NAME_MAX_LENGTH) : undefined;
  const hasExecution = type === "edit-site-selector" && (message.pathPrefix !== undefined || message.maxClicks !== undefined);
  const execution = hasExecution ? getExecutionOptions(message.pathPrefix, message.maxClicks) : undefined;
  if (typeof selector !== "string" || !selector.trim() || (type === "edit-site-selector" && !replacement.trim()) ||
      (hasExecution && !execution) ||
      (isPickedReplacement && (typeof expectedId !== "string" || !expectedId))) {
    sendResponse({ ok: false });
    return;
  }
  let request: SelectorUpdate;
  switch (type) {
    case "set-rule-paused":
      if (typeof paused !== "boolean" || typeof expectedId !== "string" || !expectedId) {
        sendResponse({ ok: false });
        return;
      }
      request = { type, selector, expectedId, paused };
      break;
    case "edit-site-selector":
      request = { type, selector, replacement, name, expectedId: typeof expectedId === "string" ? expectedId : undefined, execution: execution ?? undefined };
      break;
    case "save-site-selector":
      request = { type, selector, name };
      break;
    case "remove-site-selector":
      request = { type, selector };
      break;
  }
  updateSiteSelectors(hostname, request).then(
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
