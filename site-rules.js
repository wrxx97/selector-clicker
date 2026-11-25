// These shared scripts can be injected twice when a tab finishes loading during authorization.
var SITE_SELECTORS_PREFIX = "siteSelectors:";
var SITE_RULE_DETAILS_PREFIX = "siteRuleDetails:";
var SITE_PAUSED_PREFIX = "sitePaused:";
var SITE_CLICK_COUNTS_PREFIX = "siteClickCounts:";
var SITE_LAST_CLICK_TIMES_PREFIX = "siteLastClickTimes:";
var TOTAL_CLICK_COUNT_KEY = "totalClickCount";
var RULE_NAME_MAX_LENGTH = 80;
var RULE_BACKUP_FORMAT = "selector-clicker-rules";
var AUTHORIZED_SITES_KEY = "authorizedSitePatterns";
var SITE_SCRIPT_FILES = ["site-rules.js", "picker.js", "content.js"];

function getSiteHostname(url) {
  try {
    const address = new URL(url);
    return address.protocol === "http:" || address.protocol === "https:" ? address.hostname : "";
  } catch {
    return "";
  }
}

function normalizeSiteHostname(value) {
  if (typeof value !== "string") return "";
  const input = value.trim();
  if (!input || /[\s/?#@\\*%]/.test(input)) return "";
  if (input.includes(":") && !(input.startsWith("[") && input.endsWith("]"))) return "";
  return getSiteHostname("https://" + input);
}

function getSiteAccessPattern(url) {
  const hostname = getSiteHostname(url);
  if (!hostname || hostname.includes("*")) return "";
  return `${new URL(url).protocol}//${hostname}/*`;
}

function siteSelectorsKey(hostname) {
  return SITE_SELECTORS_PREFIX + hostname;
}

function siteRuleDetailsKey(hostname) {
  return SITE_RULE_DETAILS_PREFIX + hostname;
}

function sitePausedKey(hostname) {
  return SITE_PAUSED_PREFIX + hostname;
}

function siteClickCountsKey(hostname) {
  return SITE_CLICK_COUNTS_PREFIX + hostname;
}

function siteLastClickTimesKey(hostname) {
  return SITE_LAST_CLICK_TIMES_PREFIX + hostname;
}

function ruleSelectorKey(selector) {
  return `selector:${selector}`;
}

function getExecutionOptions(pathPrefix = "", maxClicks = 0) {
  if (typeof pathPrefix !== "string" || !Number.isSafeInteger(maxClicks) || maxClicks < 0) return null;
  const path = pathPrefix.trim();
  if (path && !/^\/(?!\/)[^?#\\\s]*$/.test(path)) return null;
  return { pathPrefix: path.replace(/\/+$/, ""), maxClicks };
}

function getSiteRules(stored, hostname) {
  const selectors = stored[siteSelectorsKey(hostname)];
  if (!Array.isArray(selectors)) return [];
  const details = stored[siteRuleDetailsKey(hostname)];
  const legacyPaused = stored[sitePausedKey(hostname)] === true;
  return selectors.filter((selector) => typeof selector === "string" && selector.trim()).map((selector) => {
    const key = ruleSelectorKey(selector);
    const detail = details?.[key];
    const id = typeof detail?.id === "string" && detail.id ? detail.id : key;
    const name = typeof detail?.name === "string" ? detail.name : "";
    const options = getExecutionOptions(detail?.pathPrefix, detail?.maxClicks) || getExecutionOptions();
    return { selector, id, name, paused: legacyPaused || detail?.paused === true, ...options };
  });
}

function getRuleSites(stored) {
  const sites = [];
  for (const key of Object.keys(stored)) {
    if (!key.startsWith(SITE_SELECTORS_PREFIX)) continue;
    const hostname = key.slice(SITE_SELECTORS_PREFIX.length);
    const rules = getSiteRules(stored, hostname);
    if (hostname && rules.length) sites.push({ hostname, rules, paused: rules.every((rule) => rule.paused) });
  }
  return sites.sort((first, second) => first.hostname.localeCompare(second.hostname));
}

function createRuleBackup(ruleSites) {
  const sites = ruleSites.map(({ hostname, paused, rules }) => ({
    hostname,
    paused,
    rules: rules.map(({ selector, name, paused, pathPrefix, maxClicks }) => ({ selector, name, paused, pathPrefix, maxClicks }))
  }));
  return { format: RULE_BACKUP_FORMAT, version: 1, sites };
}

function parseRuleBackup(backup, isValidSelector = () => true) {
  if (backup?.format !== RULE_BACKUP_FORMAT || backup.version !== 1 || !Array.isArray(backup.sites)) {
    throw new Error("Invalid Selector Clicker backup format");
  }
  const hosts = new Set();
  return backup.sites.map((site) => {
    const { hostname, paused: sitePaused = false, rules } = site || {};
    if (typeof hostname !== "string" || !hostname || getSiteHostname(`https://${hostname}`) !== hostname ||
        typeof sitePaused !== "boolean" || hosts.has(hostname) || !Array.isArray(rules)) {
      throw new Error("Invalid site in rule backup");
    }
    hosts.add(hostname);
    return { hostname, paused: sitePaused, rules: rules.map((rule) => {
      const { selector, name = "", paused = false, pathPrefix, maxClicks } = rule || {};
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

function planRuleImport(stored, sites) {
  return sites.map((site) => {
    const existing = getSiteRules(stored, site.hostname);
    const selectors = new Set(existing.map((rule) => rule.selector.trim()));
    const added = [];
    for (const rule of site.rules) {
      if (selectors.has(rule.selector)) continue;
      selectors.add(rule.selector);
      added.push(rule);
    }
    return { ...site, existing, added, duplicates: site.rules.length - added.length };
  });
}
