type RuntimeRule = import("../lib/extension-types").Rule;
type RuntimeHideRule = import("../lib/extension-types").HideRule;
type RuntimeHideDraft = import("../lib/extension-types").HideRuleDraft;
type RuntimeManagedRuleSite = import("../lib/extension-types").ManagedRuleSite;
type RuntimeRuleSite = import("../lib/extension-types").RuleSite;
type RuntimeStored = import("../lib/extension-types").StoredValues;
type RuntimeBackup = import("../lib/extension-types").RuleBackup;
type RuntimeBackupSite = import("../lib/extension-types").BackupSite;
type RuntimeImportSite = import("../lib/extension-types").ImportSite;
type RuntimeExecution = Pick<RuntimeRule, "pathPrefix" | "maxClicks">;
type RuntimeRuleDetails = Record<string, Partial<Omit<RuntimeRule, "selector">>>;

function recordValues(value: unknown): RuntimeStored {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RuntimeStored : {};
}

function storageStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function ruleDetails(value: unknown): RuntimeRuleDetails {
  return recordValues(value) as RuntimeRuleDetails;
}

// These shared scripts can be injected twice when a tab finishes loading during authorization.
var SITE_SELECTORS_PREFIX = "siteSelectors:";
var SITE_HIDE_RULES_PREFIX = "siteHideRules:";
var SITE_RULE_DETAILS_PREFIX = "siteRuleDetails:";
var SITE_PAUSED_PREFIX = "sitePaused:";
var SITE_CLICK_COUNTS_PREFIX = "siteClickCounts:";
var SITE_LAST_CLICK_TIMES_PREFIX = "siteLastClickTimes:";
var TOTAL_CLICK_COUNT_KEY = "totalClickCount";
var RULE_NAME_MAX_LENGTH = 80;
var RULE_BACKUP_FORMAT = "selector-clicker-rules";
var AUTHORIZED_SITES_KEY = "authorizedSitePatterns";
var BROWSER_CLICK_ENABLED_KEY = "experimentalBrowserClick";

function supportsBrowserClick() {
  return chrome.runtime.getManifest().permissions?.includes("debugger") === true;
}
var SITE_SCRIPT_FILES = ["site-rules.js", "picker.js", "content.js"];

function getSiteHostname(url: unknown) {
  if (typeof url !== "string") return "";
  try {
    const address = new URL(url);
    return address.protocol === "http:" || address.protocol === "https:" ? address.hostname : "";
  } catch {
    return "";
  }
}

function normalizeSiteHostname(value: unknown) {
  if (typeof value !== "string") return "";
  const input = value.trim();
  if (!input || /[\s/?#@\\*%]/.test(input)) return "";
  if (input.includes(":") && !(input.startsWith("[") && input.endsWith("]"))) return "";
  return getSiteHostname("https://" + input);
}

function getSiteAccessPattern(url: unknown) {
  if (typeof url !== "string") return "";
  const hostname = getSiteHostname(url);
  if (!hostname || hostname.includes("*")) return "";
  return `${new URL(url).protocol}//${hostname}/*`;
}

function siteSelectorsKey(hostname: string) {
  return SITE_SELECTORS_PREFIX + hostname;
}

function siteHideRulesKey(hostname: string) {
  return SITE_HIDE_RULES_PREFIX + hostname;
}

function normalizeHideText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function getHideRuleDraft(value: unknown): RuntimeHideDraft | null {
  const { selector, name, contains } = recordValues(value);
  if (typeof selector !== "string" || !selector.trim() || typeof name !== "string") return null;
  const rule: RuntimeHideDraft = { selector: selector.trim(), name: name.trim().slice(0, RULE_NAME_MAX_LENGTH) };
  if (contains !== undefined) {
    const condition = recordValues(contains);
    if (typeof condition.selector !== "string" || !condition.selector.trim() || typeof condition.text !== "string" ||
        condition.text.length > RULE_NAME_MAX_LENGTH) return null;
    rule.contains = { selector: condition.selector.trim(), text: normalizeHideText(condition.text) };
  }
  return rule;
}

function getSiteHideRules(stored: RuntimeStored, hostname: string): RuntimeHideRule[] {
  const value = stored[siteHideRulesKey(hostname)];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const { id, paused } = recordValues(entry);
    const draft = getHideRuleDraft(entry);
    return draft && typeof id === "string" && id && typeof paused === "boolean" ? [{ ...draft, id, paused }] : [];
  });
}

function sameHideTarget(first: RuntimeHideDraft, second: RuntimeHideDraft) {
  return first.selector === second.selector && first.contains?.selector === second.contains?.selector &&
    first.contains?.text === second.contains?.text;
}

function canHideElement(element: Element): element is HTMLElement | SVGElement {
  return element.isConnected && "style" in element &&
    !element.matches("html, body, frame, selector-clicker-picker");
}

function findHideTargets({ selector, contains }: RuntimeHideDraft, root: ParentNode = document) {
  try {
    const targets = [...root.querySelectorAll(selector)];
    if (!contains) return targets.length === 1 ? targets.filter(canHideElement) : [];
    return targets.filter(canHideElement).filter((target) =>
      [...target.querySelectorAll(contains.selector)].some((marker) =>
        !contains.text || normalizeHideText(marker.textContent ?? "") === contains.text));
  } catch {
    return [];
  }
}

function siteRuleDetailsKey(hostname: string) {
  return SITE_RULE_DETAILS_PREFIX + hostname;
}

function sitePausedKey(hostname: string) {
  return SITE_PAUSED_PREFIX + hostname;
}

function siteClickCountsKey(hostname: string) {
  return SITE_CLICK_COUNTS_PREFIX + hostname;
}

function siteLastClickTimesKey(hostname: string) {
  return SITE_LAST_CLICK_TIMES_PREFIX + hostname;
}

function ruleSelectorKey(selector: string) {
  return `selector:${selector}`;
}

function getExecutionOptions(pathPrefix: unknown = "", maxClicks: unknown = 0): RuntimeExecution | null {
  if (typeof pathPrefix !== "string" || typeof maxClicks !== "number" || !Number.isSafeInteger(maxClicks) || maxClicks < 0) return null;
  const path = pathPrefix.trim();
  if (path && !/^\/(?!\/)[^?#\\\s]*$/.test(path)) return null;
  return { pathPrefix: path.replace(/\/+$/, ""), maxClicks };
}

function getSiteRules(stored: RuntimeStored, hostname: string): RuntimeRule[] {
  const selectors = storageStrings(stored[siteSelectorsKey(hostname)]);
  const details = ruleDetails(stored[siteRuleDetailsKey(hostname)]);
  const legacyPaused = stored[sitePausedKey(hostname)] === true;
  return selectors.filter((selector) => selector.trim()).map((selector) => {
    const key = ruleSelectorKey(selector);
    const detail = details?.[key];
    const id = typeof detail?.id === "string" && detail.id ? detail.id : key;
    const name = typeof detail?.name === "string" ? detail.name : "";
    const options = getExecutionOptions(detail?.pathPrefix, detail?.maxClicks) || { pathPrefix: "", maxClicks: 0 };
    return { selector, id, name, paused: legacyPaused || detail?.paused === true, ...options };
  });
}

function getRuleSites(stored: RuntimeStored): RuntimeRuleSite[] {
  const sites = [];
  for (const key of Object.keys(stored)) {
    if (!key.startsWith(SITE_SELECTORS_PREFIX)) continue;
    const hostname = key.slice(SITE_SELECTORS_PREFIX.length);
    const rules = getSiteRules(stored, hostname);
    if (hostname && rules.length) sites.push({ hostname, rules, paused: rules.every((rule) => rule.paused) });
  }
  return sites.sort((first, second) => first.hostname.localeCompare(second.hostname));
}

function getManagedRuleSites(stored: RuntimeStored): RuntimeManagedRuleSite[] {
  const sites = new Map(getRuleSites(stored).map((site): [string, RuntimeManagedRuleSite] =>
    [site.hostname, { ...site, hideRules: [] }]));
  for (const key of Object.keys(stored)) {
    if (!key.startsWith(SITE_HIDE_RULES_PREFIX)) continue;
    const hostname = key.slice(SITE_HIDE_RULES_PREFIX.length);
    const hideRules = getSiteHideRules(stored, hostname);
    if (!hostname || !hideRules.length) continue;
    const site = sites.get(hostname);
    sites.set(hostname, {
      hostname, rules: site?.rules ?? [], hideRules,
      paused: (site?.paused ?? true) && hideRules.every((rule) => rule.paused)
    });
  }
  return [...sites.values()].sort((first, second) => first.hostname.localeCompare(second.hostname));
}

function createRuleBackup(ruleSites: RuntimeManagedRuleSite[]): RuntimeBackup {
  const sites = ruleSites.map(({ hostname, paused, rules, hideRules }) => ({
    hostname,
    paused,
    rules: rules.map(({ selector, name, paused, pathPrefix, maxClicks }) => ({ selector, name, paused, pathPrefix, maxClicks })),
    ...(hideRules.length ? { hideRules: hideRules.map(({ selector, name, paused, contains }) => ({
      selector, name, paused, ...(contains ? { contains } : {})
    })) } : {})
  }));
  return { format: RULE_BACKUP_FORMAT, version: 1, sites };
}

function parseRuleBackup(input: unknown, isValidSelector: (selector: string) => boolean = () => true): RuntimeBackupSite[] {
  const backup = recordValues(input);
  if (backup?.format !== RULE_BACKUP_FORMAT || backup.version !== 1 || !Array.isArray(backup.sites)) {
    throw new Error("Invalid Selector Clicker backup format");
  }
  const hosts = new Set();
  return backup.sites.map((site) => {
    const { hostname, paused: sitePaused = false, rules, hideRules = [] } = recordValues(site);
    if (typeof hostname !== "string" || !hostname || getSiteHostname(`https://${hostname}`) !== hostname ||
        typeof sitePaused !== "boolean" || hosts.has(hostname) || !Array.isArray(rules) || !Array.isArray(hideRules)) {
      throw new Error("Invalid site in rule backup");
    }
    hosts.add(hostname);
    const hidden = hideRules.map((rule) => {
      const { selector, name = "", paused = false, contains } = recordValues(rule);
      const { selector: markerSelector, text = "" } = recordValues(contains);
      const draft = getHideRuleDraft({
        selector, name, ...(contains !== undefined ? { contains: { selector: markerSelector, text } } : {})
      });
      if (!draft || typeof paused !== "boolean" || !isValidSelector(draft.selector) ||
          (draft.contains && !isValidSelector(draft.contains.selector))) {
        throw new Error("Invalid hide rule in backup");
      }
      return { ...draft, paused: sitePaused || paused };
    });

    return { hostname, paused: sitePaused, hideRules: hidden, rules: rules.map((rule) => {
      const { selector, name = "", paused = false, pathPrefix, maxClicks } = recordValues(rule);
      const execution = getExecutionOptions(pathPrefix, maxClicks);
      if (typeof selector !== "string" || !selector.trim() || !isValidSelector(selector) ||
          typeof name !== "string" || typeof paused !== "boolean" || !execution) {
        throw new Error("Invalid rule in backup");
      }
      return {
        selector: selector.trim(), name: name.trim().slice(0, RULE_NAME_MAX_LENGTH),
        paused: sitePaused || paused, ...execution
      };
    }) };
  });
}

function planRuleImport(stored: RuntimeStored, sites: RuntimeBackupSite[]): RuntimeImportSite[] {
  return sites.map((site) => {
    const existing = getSiteRules(stored, site.hostname);
    const selectors = new Set(existing.map((rule) => rule.selector.trim()));
    const added = [];
    for (const rule of site.rules) {
      if (selectors.has(rule.selector)) continue;
      selectors.add(rule.selector);
      added.push(rule);
    }
    const existingHideRules = getSiteHideRules(stored, site.hostname);
    const hideRules = site.hideRules ?? [];
    const hideTargetKey = ({ selector, contains }: RuntimeHideDraft) =>
      JSON.stringify([selector, contains?.selector, contains?.text]);
    const hideTargets = new Set(existingHideRules.map(hideTargetKey));
    const addedHideRules = hideRules.filter((rule) => {
      const key = hideTargetKey(rule);
      if (hideTargets.has(key)) return false;
      hideTargets.add(key);
      return true;
    });
    return {
      ...site, existing, added, existingHideRules, addedHideRules,
      duplicates: site.rules.length - added.length + hideRules.length - addedHideRules.length
    };
  });
}
