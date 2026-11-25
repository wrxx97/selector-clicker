import type {
  ActiveSite, PageRequest, PageResponses, PauseOptions, Rule,
  StorageChanges, StoredValues, WorkerRequest, WorkerResponse
} from "./extension-types";

// These helpers load first as the same classic script used in the worker and on websites.
const ruleData = globalThis;

export const {
  RULE_NAME_MAX_LENGTH, TOTAL_CLICK_COUNT_KEY, AUTHORIZED_SITES_KEY, getExecutionOptions,
  getRuleSites, getSiteRules, normalizeSiteHostname, siteClickCountsKey, siteLastClickTimesKey,
  createRuleBackup, parseRuleBackup, planRuleImport
} = ruleData;

const DEFAULT_COOLDOWN = 8000;
export const cooldownRange = { min: 1000, max: 300000 };

export function normalizeCooldown(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(cooldownRange.max, Math.max(cooldownRange.min, value))
    : DEFAULT_COOLDOWN;
}

export async function readCooldown(): Promise<number> {
  const { cooldown } = await chrome.storage.sync.get({ cooldown: DEFAULT_COOLDOWN });
  return normalizeCooldown(cooldown);
}

export async function readEnabled(): Promise<boolean> {
  const { enabled } = await chrome.storage.sync.get({ enabled: false });
  return enabled === true;
}

export const readRules = (): Promise<StoredValues> => chrome.storage.sync.get(null);
export const readStats = (): Promise<StoredValues> => chrome.storage.local.get(null);
export const send = (message: WorkerRequest): Promise<WorkerResponse | undefined> => chrome.runtime.sendMessage(message);
export const openRules = () => chrome.runtime.openOptionsPage();

export async function readActiveSite(): Promise<ActiveSite | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const hostname = ruleData.getSiteHostname(tab?.url);
  const pattern = ruleData.getSiteAccessPattern(tab?.url);
  return tab?.id != null && hostname && pattern ? { id: tab.id, hostname, pattern } : null;
}

export async function readSiteRules(hostname: string): Promise<Rule[]> {
  const key = ruleData.sitePausedKey(hostname);
  const stored = await chrome.storage.sync.get({
    [ruleData.siteSelectorsKey(hostname)]: [],
    [ruleData.siteRuleDetailsKey(hostname)]: {},
    [key]: false
  });
  return getSiteRules(stored, hostname);
}

export function isRuleChange(changes: StorageChanges, hostname?: string) {
  const prefixes = [ruleData.SITE_SELECTORS_PREFIX, ruleData.SITE_RULE_DETAILS_PREFIX, ruleData.SITE_PAUSED_PREFIX];
  return hostname
    ? prefixes.some((prefix) => Object.hasOwn(changes, prefix + hostname))
    : Object.keys(changes).some((key) => prefixes.some((prefix) => key.startsWith(prefix)));
}

export function isStatsKey(key: string) {
  return key === TOTAL_CLICK_COUNT_KEY ||
    key.startsWith(ruleData.SITE_CLICK_COUNTS_PREFIX) || key.startsWith(ruleData.SITE_LAST_CLICK_TIMES_PREFIX);
}

export function listenToStorage(listener: (changes: StorageChanges, area: string) => void) {
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export const saveEnabled = (enabled: boolean) => chrome.storage.sync.set({ enabled });
export const saveCooldown = (cooldown: number) => chrome.storage.sync.set({ cooldown: normalizeCooldown(cooldown) });

export async function hasSiteAccess(pattern: string) {
  const [stored, granted] = await Promise.all([
    chrome.storage.local.get({ [AUTHORIZED_SITES_KEY]: [] }),
    chrome.permissions.contains({ origins: [pattern] })
  ]);
  const patterns = stored[AUTHORIZED_SITES_KEY];
  return granted && Array.isArray(patterns) && patterns.includes(pattern);
}

export async function requestSiteAccess(pattern: string) {
  if (!await chrome.permissions.request({ origins: [pattern] })) return false;
  const result = await send({ type: "authorize-site", pattern });
  if (!result?.ok) throw new Error("Could not register site scripts");
  return true;
}

export function sendToPage<Message extends PageRequest>(
  site: ActiveSite, message: Message
): Promise<PageResponses[Message["type"]] | undefined> {
  return chrome.tabs.sendMessage(site.id, { ...message, hostname: site.hostname });
}

export async function connectToPage(site: ActiveSite) {
  const request = { type: "get-status" } as const;
  const existing = await sendToPage(site, request).catch(() => undefined);
  if (existing?.authorized) return existing;
  await chrome.scripting.executeScript({ target: { tabId: site.id }, files: ruleData.SITE_SCRIPT_FILES });
  const status = await sendToPage(site, request);
  if (!status?.authorized) throw new Error("Site is not authorized");
  return status;
}

export async function changePause(hostname: string, options: PauseOptions) {
  const result = await send(options.selector
    ? { type: "set-rule-paused", hostname, selector: options.selector, expectedId: options.expectedId, paused: options.paused }
    : { type: "set-site-paused", hostname, paused: options.paused });
  if (!result?.ok) throw new Error("Pause failed");
}
