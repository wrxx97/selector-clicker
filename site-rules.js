function getSiteHostname(url) {
  try {
    const address = new URL(url);
    return address.protocol === "http:" || address.protocol === "https:" ? address.hostname : "";
  } catch {
    return "";
  }
}

function siteSelectorsKey(hostname) {
  return `siteSelectors:${hostname}`;
}
