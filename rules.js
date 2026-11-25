const elements = {
  search: document.querySelector("#rule-search"),
  summary: document.querySelector("#rule-summary"),
  totalClicks: document.querySelector("#total-clicks"),
  notice: document.querySelector("#notice"),
  groups: document.querySelector("#site-groups"),
  groupTemplate: document.querySelector("#group-template"),
  ruleTemplate: document.querySelector("#rule-template"),
  empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  dialog: document.querySelector("#rule-dialog"),
  form: document.querySelector("#rule-form"),
  title: document.querySelector("#dialog-title"),
  site: document.querySelector("#dialog-site"),
  editor: document.querySelector("#selector-editor"),
  name: document.querySelector("#name-input"),
  input: document.querySelector("#selector-input"),
  preview: document.querySelector("#selector-preview"),
  error: document.querySelector("#dialog-error"),
  cancel: document.querySelector("#cancel-action"),
  confirm: document.querySelector("#confirm-action")
};

let sites;
let loadRevision = 0;
let statsRevision = 0;
let clickStats;
let clickCountElements = [];
let pendingAction;
let saving = false;
const countFormatter = new Intl.NumberFormat("zh-CN");
elements.name.maxLength = RULE_NAME_MAX_LENGTH;

function setNotice(message, error = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle("is-error", error);
}

function createGroup(hostname, rules) {
  const group = elements.groupTemplate.content.firstElementChild.cloneNode(true);
  group.querySelector("h2").textContent = hostname;
  group.querySelector("header span").textContent = `${rules.length} 条规则`;
  const list = group.querySelector("ul");
  for (const rule of rules) {
    const { selector, name, id } = rule;
    const row = elements.ruleTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector("code").textContent = selector;
    const label = row.querySelector(".rule-name");
    label.textContent = name;
    label.hidden = !name;
    clickCountElements.push({ hostname, id, node: row.querySelector(".rule-click-count") });
    const edit = row.querySelector(".edit-rule");
    const remove = row.querySelector(".remove-rule");
    edit.setAttribute("aria-label", `编辑规则 ${name || selector}`);
    remove.setAttribute("aria-label", `移除规则 ${name || selector}`);
    edit.addEventListener("click", () => openRuleDialog(hostname, rule, false));
    remove.addEventListener("click", () => openRuleDialog(hostname, rule, true));
    list.append(row);
  }
  return group;
}

function renderRules() {
  if (!sites) return;
  const query = elements.search.value.trim().toLowerCase();
  const groups = [];
  clickCountElements = [];
  let ruleCount = 0;
  for (const [hostname, rules] of sites) {
    const matches = hostname.toLowerCase().includes(query)
      ? rules
      : rules.filter(({ selector, name }) => selector.toLowerCase().includes(query) || name.toLowerCase().includes(query));
    if (!matches.length) continue;
    groups.push(createGroup(hostname, matches));
    ruleCount += matches.length;
  }
  elements.groups.replaceChildren(...groups);
  renderClickStats();
  elements.summary.textContent = `${query ? "找到 " : ""}${groups.length} 个网站 · ${ruleCount} 条规则`;
  elements.empty.hidden = groups.length > 0;
  if (groups.length === 0) {
    elements.emptyTitle.textContent = sites.length ? "没有匹配的规则" : "还没有站点规则";
    elements.emptyDescription.textContent = sites.length
      ? "试试其他网站名称、备注或选择器。"
      : "在目标网页打开扩展弹窗，点击「在页面上选取元素」添加规则。";
  }
}

async function loadRules() {
  const revision = ++loadRevision;
  try {
    const stored = await chrome.storage.sync.get(null);
    if (revision !== loadRevision) return;
    sites = [];
    for (const key of Object.keys(stored)) {
      if (!key.startsWith(SITE_SELECTORS_PREFIX)) continue;
      const hostname = key.slice(SITE_SELECTORS_PREFIX.length);
      const rules = getSiteRules(stored, hostname);
      if (hostname && rules.length) sites.push([hostname, rules]);
    }
    sites.sort(([first], [second]) => first.localeCompare(second));
    if (elements.notice.classList.contains("is-error")) setNotice("");
    renderRules();
  } catch {
    if (revision !== loadRevision) return;
    if (!sites) elements.summary.textContent = "规则暂不可用";
    setNotice("无法读取站点规则，请重新打开此页面。", true);
  }
}

function renderClickStats() {
  elements.totalClicks.textContent = clickStats ? countFormatter.format(clickStats[TOTAL_CLICK_COUNT_KEY] || 0) : "—";
  for (const { hostname, id, node } of clickCountElements) {
    const count = clickStats?.[siteClickCountsKey(hostname)]?.[`rule:${id}`] || 0;
    node.textContent = clickStats ? `${countFormatter.format(count)} 次` : "—";
  }
}

async function loadClickStats() {
  const revision = ++statsRevision;
  try {
    const stored = await chrome.storage.local.get(null);
    if (revision !== statsRevision) return;
    clickStats = stored;
    renderClickStats();
  } catch {
    if (revision !== statsRevision) return;
    clickStats = undefined;
    renderClickStats();
  }
}

function openRuleDialog(hostname, { selector, name }, remove) {
  pendingAction = { hostname, selector, remove };
  setNotice("");
  elements.title.textContent = remove ? "移除这条规则？" : "编辑规则";
  elements.site.textContent = remove && name ? `${hostname} · ${name}` : hostname;
  elements.editor.hidden = remove;
  elements.input.value = remove ? "" : selector;
  elements.name.value = remove ? "" : name;
  elements.preview.hidden = !remove;
  elements.preview.textContent = remove ? selector : "";
  elements.error.textContent = "";
  elements.confirm.textContent = remove ? "移除规则" : "保存修改";
  elements.confirm.classList.toggle("danger", remove);
  elements.dialog.showModal();
  if (remove) elements.cancel.focus();
  else elements.name.focus();
}

function validateReplacement(selector) {
  if (!selector.trim()) return "请输入 CSS 选择器。";
  try {
    document.createDocumentFragment().querySelector(selector);
    return "";
  } catch {
    return "CSS 选择器格式无效，请检查后重试。";
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !pendingAction) return;
  const { hostname, selector, remove } = pendingAction;
  const replacement = elements.input.value;
  elements.error.textContent = remove ? "" : validateReplacement(replacement);
  if (elements.error.textContent) {
    elements.input.focus();
    return;
  }
  saving = true;
  elements.confirm.disabled = true;
  elements.cancel.disabled = true;
  elements.input.readOnly = true;
  elements.name.readOnly = true;
  const failure = remove ? "移除规则失败，请重试。" : "保存修改失败，请重试。";
  try {
    const response = await chrome.runtime.sendMessage({
      type: remove ? "remove-site-selector" : "edit-site-selector",
      hostname,
      selector,
      replacement,
      name: elements.name.value
    });
    if (!response?.ok) {
      if (response?.reason === "duplicate") elements.error.textContent = "此网站已有相同的选择器。";
      else if (response?.reason === "missing") elements.error.textContent = "这条规则已变更，请返回列表重新选择。";
      else elements.error.textContent = failure;
      return;
    }
    elements.dialog.close();
    setNotice(remove ? "已移除规则。" : "已保存修改。");
    elements.search.focus();
  } catch {
    elements.error.textContent = failure;
  } finally {
    saving = false;
    elements.confirm.disabled = false;
    elements.cancel.disabled = false;
    elements.input.readOnly = false;
    elements.name.readOnly = false;
  }
});

elements.search.addEventListener("input", renderRules);
elements.cancel.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("cancel", (event) => {
  if (saving) event.preventDefault();
});
elements.dialog.addEventListener("close", () => {
  if (!elements.dialog.open) pendingAction = undefined;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && Object.keys(changes).some((key) =>
    key.startsWith(SITE_SELECTORS_PREFIX) || key.startsWith(SITE_RULE_DETAILS_PREFIX))) loadRules();
  if (area === "local" && Object.hasOwn(changes, TOTAL_CLICK_COUNT_KEY)) loadClickStats();
});
loadRules();
loadClickStats();
