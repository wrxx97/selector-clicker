// The same rule helpers also run as classic scripts in the worker and on websites.
export const {
  RULE_NAME_MAX_LENGTH,
  TOTAL_CLICK_COUNT_KEY,
  getExecutionOptions,
  getRuleSites,
  getSiteRules,
  siteClickCountsKey,
  siteLastClickTimesKey,
  createRuleBackup,
  parseRuleBackup,
  planRuleImport
} = globalThis;

export const settingsDefaults = { enabled: false, cooldown: 8000 };

export const readSettings = () => chrome.storage.sync.get(settingsDefaults);
export const readRules = () => chrome.storage.sync.get(null);
export const readStats = () => chrome.storage.local.get(null);
export const send = (message) => chrome.runtime.sendMessage(message);
export const openRules = () => chrome.runtime.openOptionsPage();

export async function readActiveSite() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const { getSiteHostname, getSiteAccessPattern } = globalThis;
  return { id: tab?.id, hostname: getSiteHostname(tab?.url), pattern: getSiteAccessPattern(tab?.url) };
}

export async function readSiteRules(hostname) {
  if (!hostname) return { rules: [], sitePaused: false };
  const { siteSelectorsKey, siteRuleDetailsKey, sitePausedKey } = globalThis;
  const key = sitePausedKey(hostname);
  const stored = await chrome.storage.sync.get({
    [siteSelectorsKey(hostname)]: [],
    [siteRuleDetailsKey(hostname)]: {},
    [key]: false
  });
  return { rules: getSiteRules(stored, hostname), sitePaused: stored[key] === true };
}

export function isRuleChange(changes) {
  const prefixes = [
    globalThis.SITE_SELECTORS_PREFIX, globalThis.SITE_RULE_DETAILS_PREFIX, globalThis.SITE_PAUSED_PREFIX
  ];
  return Object.keys(changes).some((key) => prefixes.some((prefix) => key.startsWith(prefix)));
}

export function listenToStorage(listener) {
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function saveSettings(enabled, cooldown) {
  const settings = {
    enabled,
    cooldown: Math.min(300000, Math.max(1000, Number(cooldown) || settingsDefaults.cooldown))
  };
  await chrome.storage.sync.set(settings);
  return settings;
}

export async function hasSiteAccess(pattern) {
  if (!pattern) return false;
  const key = globalThis.AUTHORIZED_SITES_KEY;
  const [stored, granted] = await Promise.all([
    chrome.storage.local.get({ [key]: [] }),
    chrome.permissions.contains({ origins: [pattern] })
  ]);
  return granted && stored[key].includes(pattern);
}

export async function requestSiteAccess(pattern) {
  if (!await chrome.permissions.request({ origins: [pattern] })) return false;
  const result = await send({ type: "authorize-site", pattern });
  if (!result?.ok) throw new Error("Could not register site scripts");
  return true;
}

export function sendToPage(site, message) {
  return chrome.tabs.sendMessage(site.id, { ...message, hostname: site.hostname });
}

export async function connectToPage(site) {
  const request = { type: "get-status" };
  const existing = await sendToPage(site, request).catch(() => undefined);
  if (existing?.authorized) return existing;
  await chrome.scripting.executeScript({ target: { tabId: site.id }, files: globalThis.SITE_SCRIPT_FILES });
  const status = await sendToPage(site, request);
  if (!status?.authorized) throw new Error("Site is not authorized");
  return status;
}

export async function changePause(hostname, options) {
  const type = options.selector ? "set-rule-paused" : "set-site-paused";
  const result = await send({ type, hostname, ...options });
  if (!result?.ok) throw new Error("Pause failed");
}
