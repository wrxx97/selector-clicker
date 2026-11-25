const DEFAULTS = {
  enabled: false,
  cooldown: 8000
};

const elements = {
  enabled: document.querySelector("#enabled"),
  cooldown: document.querySelector("#cooldown"),
  save: document.querySelector("#save"),
  scanNow: document.querySelector("#scan-now"),
  manageRules: document.querySelector("#manage-rules"),
  pickElement: document.querySelector("#pick-element"),
  pickerStatus: document.querySelector("#picker-status"),
  siteRules: document.querySelector("#site-rules"),
  siteRuleList: document.querySelector("#site-rule-list"),
  toggleSitePause: document.querySelector("#toggle-site-pause"),
  ruleCount: document.querySelector("#rule-count"),
  emptyRules: document.querySelector("#empty-rules"),
  settingsStatus: document.querySelector("#settings-status"),
  siteName: document.querySelector("#site-name"),
  status: document.querySelector("#status"),
  statusDot: document.querySelector("#status-dot"),
  clickCount: document.querySelector("#click-count"),
  totalClickCount: document.querySelector("#total-click-count")
};

let activeTab;
let activeHostname;
let pageClicks;
let sitePaused = false;

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

function updateTotalClickCount(count = 0) {
  elements.totalClickCount.textContent = `本机累计 ${count.toLocaleString("zh-CN")} 次`;
  elements.totalClickCount.hidden = false;
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

function renderSiteRules(rules) {
  const items = rules.map(({ selector, name, id, paused }) => {
    const item = document.createElement("li");
    const details = document.createElement("div");
    details.className = "rule-details";
    if (name) {
      const label = document.createElement("strong");
      label.textContent = name;
      details.append(label);
    }
    const code = document.createElement("code");
    code.textContent = selector;
    details.append(code);
    const actions = document.createElement("div");
    actions.className = "site-rule-actions";
    for (const [label, action] of [
      ["测试", (button) => testSiteRule(selector, button)],
      [paused ? "恢复" : "暂停", (button) => changePause(button, { selector, expectedId: id, paused: !paused })],
      ["重新选取", (button) => startPicker(button, { selector, expectedId: id })]
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", `${label}规则 ${name || selector}`);
      button.addEventListener("click", () => action(button));
      actions.append(button);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-rule";
    remove.textContent = "移除";
    remove.setAttribute("aria-label", `移除规则 ${name || selector}`);
    remove.addEventListener("click", () => removeSiteRule(selector, remove));
    actions.append(remove);
    item.append(details, actions);
    return item;
  });
  elements.siteRuleList.replaceChildren(...items);
  elements.toggleSitePause.hidden = !items.length;
  elements.toggleSitePause.textContent = sitePaused ? "恢复当前站点" : "暂停当前站点";
  elements.siteRules.hidden = !items.length;
  elements.emptyRules.hidden = items.length > 0;
  elements.ruleCount.hidden = false;
  elements.ruleCount.textContent = `${items.length} 条规则`;
}

async function testSiteRule(selector, button) {
  const messages = {
    ready: "匹配到一个可点击元素，已在页面高亮。",
    missing: "当前页面没有匹配元素。",
    removed: "这条规则已移除或修改，请重新打开弹窗。",
    hidden: "匹配的元素不可见。",
    disabled: "匹配的元素不可点击。",
    cooldown: "匹配的元素仍在点击冷却中。",
    "site-paused": "当前站点已暂停。",
    "rule-paused": "这条规则已暂停。",
    invalid: "CSS 选择器格式无效。"
  };
  button.disabled = true;
  try {
    const result = await chrome.tabs.sendMessage(activeTab.id, { type: "test-rule", hostname: activeHostname, selector });
    if (!result) throw new Error("Page unavailable");
    const text = result.status === "ambiguous" ? `匹配到 ${result.count} 个元素，请重新选取。` : messages[result.status];
    setFeedback(elements.pickerStatus, text);
  } catch {
    setFeedback(elements.pickerStatus, "无法测试此页面，请刷新后重试。", true);
  } finally {
    button.disabled = false;
  }
}

async function changePause(button, options) {
  button.disabled = true;
  try {
    const type = options.selector ? "set-rule-paused" : "set-site-paused";
    const result = await chrome.runtime.sendMessage({ type, hostname: activeHostname, ...options });
    if (!result?.ok) throw new Error("Pause failed");
    setFeedback(elements.pickerStatus, options.paused ? "已暂停自动点击。" : "已恢复自动点击。");
    await loadSiteRules();
  } catch {
    setFeedback(elements.pickerStatus, "无法修改暂停状态，请重试。", true);
  } finally {
    button.disabled = false;
  }
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
    await loadSiteRules();
  } catch {
    setFeedback(elements.pickerStatus, "移除失败，请重试。", true);
    button.disabled = false;
  }
}

async function loadSiteRules() {
  const stored = await chrome.storage.sync.get({
    [siteSelectorsKey(activeHostname)]: [],
    [siteRuleDetailsKey(activeHostname)]: {},
    [sitePausedKey(activeHostname)]: false
  });
  sitePaused = stored[sitePausedKey(activeHostname)] === true;
  renderSiteRules(getSiteRules(stored, activeHostname));
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
  if (activeHostname) await loadSiteRules();
  await refreshPageStatus();
}

elements.manageRules.addEventListener("click", async () => {
  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch {
    setFeedback(elements.pickerStatus, "无法打开规则管理页面，请重试。", true);
  }
});

async function startPicker(button, rule = {}) {
  button.disabled = true;
  setFeedback(elements.pickerStatus, "");
  try {
    const response = await chrome.tabs.sendMessage(activeTab.id, { type: "start-picker", hostname: activeHostname, ...rule });
    if (!response?.ok) throw new Error("Could not start picker");
    window.close();
  } catch {
    setFeedback(elements.pickerStatus, "无法进入选取模式，请刷新网页后重试。", true);
    button.disabled = false;
  }
}

elements.pickElement.addEventListener("click", () => startPicker(elements.pickElement));
elements.toggleSitePause.addEventListener("click", () => changePause(elements.toggleSitePause, { paused: !sitePaused }));

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
chrome.storage.local.get({ [TOTAL_CLICK_COUNT_KEY]: 0 }).then((stored) => {
  updateTotalClickCount(stored[TOTAL_CLICK_COUNT_KEY]);
}).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && Object.hasOwn(changes, TOTAL_CLICK_COUNT_KEY)) {
    updateTotalClickCount(changes[TOTAL_CLICK_COUNT_KEY].newValue);
  }
});
