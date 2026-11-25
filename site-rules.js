const SITE_SELECTORS_PREFIX = "siteSelectors:";
const SITE_RULE_DETAILS_PREFIX = "siteRuleDetails:";
const SITE_CLICK_COUNTS_PREFIX = "siteClickCounts:";
const TOTAL_CLICK_COUNT_KEY = "totalClickCount";
const RULE_NAME_MAX_LENGTH = 80;

function getSiteHostname(url) {
  try {
    const address = new URL(url);
    return address.protocol === "http:" || address.protocol === "https:" ? address.hostname : "";
  } catch {
    return "";
  }
}

function siteSelectorsKey(hostname) {
  return SITE_SELECTORS_PREFIX + hostname;
}

function siteRuleDetailsKey(hostname) {
  return SITE_RULE_DETAILS_PREFIX + hostname;
}

function siteClickCountsKey(hostname) {
  return SITE_CLICK_COUNTS_PREFIX + hostname;
}

function ruleSelectorKey(selector) {
  return `selector:${selector}`;
}

function getSiteRules(stored, hostname) {
  const selectors = stored[siteSelectorsKey(hostname)];
  if (!Array.isArray(selectors)) return [];
  const details = stored[siteRuleDetailsKey(hostname)];
  return selectors.filter((selector) => typeof selector === "string" && selector.trim()).map((selector) => {
    const key = ruleSelectorKey(selector);
    const detail = details?.[key];
    const id = typeof detail?.id === "string" && detail.id ? detail.id : key;
    const name = typeof detail?.name === "string" ? detail.name : "";
    return { selector, id, name };
  });
}
