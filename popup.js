const DEFAULTS = {
  enabled: false,
  cooldown: 8000
};

const elements = {
  enabled: document.querySelector("#enabled"),
  cooldown: document.querySelector("#cooldown"),
  save: document.querySelector("#save"),
  scanNow: document.querySelector("#scan-now"),
  pickElement: document.querySelector("#pick-element"),
  pickerStatus: document.querySelector("#picker-status"),
  siteRules: document.querySelector("#site-rules"),
  siteRuleList: document.querySelector("#site-rule-list"),
  ruleCount: document.querySelector("#rule-count"),
  emptyRules: document.querySelector("#empty-rules"),
  settingsStatus: document.querySelector("#settings-status"),
  siteName: document.querySelector("#site-name"),
  status: document.querySelector("#status"),
  statusDot: document.querySelector("#status-dot"),
  clickCount: document.querySelector("#click-count")
};

let activeTab;
let activeHostname;
let pageClicks;

function setFeedback(element, text, error = false) {
  element.textContent = text;
  element.classList.toggle("error", error);
}

function updateStatus(enabled, totalClicks = pageClicks) {
  pageClicks = totalClicks;
  elements.status.textContent = enabled ? "已启用" : "已停用";
  elements.statusDot.classList.toggle("active", enabled);
  elements.clickCount.hidden = totalClicks == null;
  elements.clickCount.textContent = totalClicks == null ? "" : `本页已点击 ${totalClicks} 次`;
}

async function saveSettings(showFeedback = false) {
  const settings = {
    enabled: elements.enabled.checked,
    cooldown: Math.min(300000, Math.max(1000, Number(elements.cooldown.value) || DEFAULTS.cooldown))
  };
  try {
    await chrome.storage.sync.set(settings);
  } catch {
    setFeedback(elements.settingsStatus, "保存设置失败，请重试。", true);
    return false;
  }
  elements.cooldown.value = settings.cooldown;
  setFeedback(elements.settingsStatus, showFeedback ? "设置已保存。" : "");
  updateStatus(settings.enabled);
  return true;
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function refreshPageStatus() {
  if (activeTab?.id == null || !activeHostname) {
    setFeedback(elements.pickerStatus, "请在普通网页上选取元素。");
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "get-status" });
    updateStatus(response.enabled, response.totalClicks);
    elements.pickElement.disabled = false;
    elements.scanNow.disabled = false;
  } catch {
    elements.emptyRules.hidden = true;
    setFeedback(elements.pickerStatus, "无法连接当前网页。重新加载扩展后，请刷新网页。", true);
  }
}

function renderSiteRules(selectors) {
  const items = selectors.map((selector) => {
    const item = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = selector;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-rule";
    remove.textContent = "移除";
    remove.setAttribute("aria-label", `移除规则 ${selector}`);
    remove.addEventListener("click", () => removeSiteRule(selector, remove));
    item.append(code, remove);
    return item;
  });
  elements.siteRuleList.replaceChildren(...items);
  elements.siteRules.hidden = !items.length;
  elements.emptyRules.hidden = items.length > 0;
  elements.ruleCount.hidden = false;
  elements.ruleCount.textContent = `${items.length} 条规则`;
}

async function removeSiteRule(selector, button) {
  button.disabled = true;
  setFeedback(elements.pickerStatus, "");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "remove-site-selector",
      hostname: activeHostname,
      selector
    });
    if (!response?.ok) throw new Error("Could not remove site rule");
    renderSiteRules(response.selectors);
  } catch {
    setFeedback(elements.pickerStatus, "移除失败，请重试。", true);
    button.disabled = false;
  }
}

async function initialize() {
  const [settings, tab] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    getCurrentTab()
  ]);
  activeTab = tab;
  activeHostname = getSiteHostname(tab?.url);
  elements.enabled.checked = settings.enabled;
  elements.cooldown.value = settings.cooldown;
  elements.siteName.textContent = activeHostname || "当前页面不可用";
  elements.siteName.title = activeHostname;

  updateStatus(settings.enabled);
  if (activeHostname) {
    const key = siteSelectorsKey(activeHostname);
    const { [key]: selectors } = await chrome.storage.sync.get({ [key]: [] });
    renderSiteRules(selectors);
  }
  await refreshPageStatus();
}

elements.pickElement.addEventListener("click", async () => {
  elements.pickElement.disabled = true;
  setFeedback(elements.pickerStatus, "");
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "start-picker" });
    if (!response?.ok) throw new Error("Could not start picker");
    window.close();
  } catch {
    setFeedback(elements.pickerStatus, "无法进入选取模式，请刷新网页后重试。", true);
    elements.pickElement.disabled = false;
  }
});

elements.save.addEventListener("click", () => saveSettings(true));
elements.enabled.addEventListener("change", () => saveSettings());
elements.scanNow.addEventListener("click", async () => {
  const isSaved = await saveSettings();
  if (!isSaved || activeTab?.id == null) return;
  if (!elements.enabled.checked) {
    setFeedback(elements.settingsStatus, "开启自动点击后即可扫描。");
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "scan-now" });
    updateStatus(elements.enabled.checked, response.totalClicks);
  } catch {
    setFeedback(elements.settingsStatus, "无法扫描此页面。", true);
  }
});

initialize();
