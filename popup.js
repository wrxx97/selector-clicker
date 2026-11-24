const DEFAULTS = {
  enabled: false,
  selectors: [],
  cooldown: 8000
};

const elements = {
  enabled: document.querySelector("#enabled"),
  selectors: document.querySelector("#selectors"),
  advanced: document.querySelector("#advanced"),
  cooldown: document.querySelector("#cooldown"),
  save: document.querySelector("#save"),
  scanNow: document.querySelector("#scan-now"),
  pickElement: document.querySelector("#pick-element"),
  pickerStatus: document.querySelector("#picker-status"),
  siteRules: document.querySelector("#site-rules"),
  siteRuleList: document.querySelector("#site-rule-list"),
  validation: document.querySelector("#validation"),
  siteName: document.querySelector("#site-name"),
  status: document.querySelector("#status"),
  statusDot: document.querySelector("#status-dot"),
  clickCount: document.querySelector("#click-count")
};

let activeTab;
let activeHostname;

function parseSelectors(value) {
  return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))];
}

function validateSelectors(selectors) {
  const invalid = [];
  for (const selector of selectors) {
    try {
      document.querySelector(selector);
    } catch {
      invalid.push(selector);
    }
  }
  return invalid;
}

function updateStatus(enabled, totalClicks = 0) {
  elements.status.textContent = enabled ? "自动点击已启用" : "自动点击已停用";
  elements.statusDot.classList.toggle("active", enabled);
  elements.clickCount.textContent = totalClicks ? `本页已点击 ${totalClicks} 次` : "";
}

async function saveSettings() {
  const selectors = parseSelectors(elements.selectors.value);
  const invalid = validateSelectors(selectors);
  if (invalid.length) {
    elements.advanced.open = true;
    elements.validation.textContent = `无效选择器：${invalid.slice(0, 2).join("；")}`;
    return false;
  }

  const settings = {
    enabled: elements.enabled.checked,
    selectors,
    cooldown: Math.min(300000, Math.max(1000, Number(elements.cooldown.value) || DEFAULTS.cooldown))
  };
  await chrome.storage.sync.set(settings);
  elements.cooldown.value = settings.cooldown;
  elements.validation.textContent = "";
  updateStatus(settings.enabled);
  return true;
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function refreshPageStatus() {
  if (activeTab?.id == null) return;
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "get-status" });
    updateStatus(response.enabled, response.totalClicks);
    elements.pickElement.disabled = !activeHostname;
    if (!activeHostname) elements.pickerStatus.textContent = "可在普通网页上选取元素。";
  } catch {
    elements.status.textContent = "此页面不支持运行扩展";
    elements.scanNow.disabled = true;
    elements.pickerStatus.textContent = "此页面无法选取元素。";
  }
}

function renderSiteRules(selectors) {
  const items = selectors.map((selector) => {
    const item = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = selector;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "移除";
    remove.setAttribute("aria-label", `移除规则 ${selector}`);
    remove.addEventListener("click", () => removeSiteRule(selector, remove));
    item.append(code, remove);
    return item;
  });
  elements.siteRuleList.replaceChildren(...items);
  elements.siteRules.hidden = !items.length;
}

async function removeSiteRule(selector, button) {
  button.disabled = true;
  elements.pickerStatus.textContent = "";
  try {
    const response = await chrome.runtime.sendMessage({
      type: "remove-site-selector",
      hostname: activeHostname,
      selector
    });
    if (!response?.ok) throw new Error("Could not remove site rule");
    renderSiteRules(response.selectors);
  } catch {
    elements.pickerStatus.textContent = "移除失败，请重试。";
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
  elements.selectors.value = settings.selectors.join("\n");
  elements.advanced.open = Boolean(settings.selectors.length);
  elements.cooldown.value = settings.cooldown;
  elements.siteName.textContent = activeHostname || "当前页面";

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
  elements.pickerStatus.textContent = "";
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "start-picker" });
    if (!response?.ok) throw new Error("Could not start picker");
    window.close();
  } catch {
    elements.pickerStatus.textContent = "无法进入选取模式，请刷新网页后重试。";
    elements.pickElement.disabled = false;
  }
});

elements.save.addEventListener("click", saveSettings);
elements.enabled.addEventListener("change", saveSettings);
elements.scanNow.addEventListener("click", async () => {
  const isSaved = await saveSettings();
  if (!isSaved || !activeTab?.id) return;
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "scan-now" });
    updateStatus(elements.enabled.checked, response.totalClicks);
  } catch {
    elements.status.textContent = "无法扫描此页面";
  }
});

initialize();
