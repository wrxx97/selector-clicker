import { createRuleBackup, getRuleSites, parseRuleBackup, planRuleImport, readRules } from "./extension.js";

export const MAX_BACKUP_BYTES = 1024 * 1024;

export function formatRuleBackup(sites) {
  return JSON.stringify(createRuleBackup(sites), null, 2) + "\n";
}

export async function exportRuleFile() {
  const file = new Blob([formatRuleBackup(getRuleSites(await readRules()))], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "selector-clicker-rules.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function validateSelector(selector) {
  if (!selector.trim()) return "请输入 CSS 选择器。";
  try {
    document.createDocumentFragment().querySelector(selector);
    return "";
  } catch {
    return "CSS 选择器格式无效，请检查后重试。";
  }
}

export async function previewRuleImport(text) {
  const input = text.trim();
  if (!input) throw new Error("请输入或粘贴规则 JSON。");
  if (new Blob([input]).size > MAX_BACKUP_BYTES) throw new Error("规则 JSON 不能超过 1 MB。");
  let backup;
  try {
    backup = JSON.parse(input);
  } catch {
    throw new Error("JSON 格式无效，请检查内容是否完整。");
  }
  let sites;
  try {
    sites = parseRuleBackup(backup, (selector) => !validateSelector(selector));
  } catch {
    throw new Error("规则格式无效，请使用 Selector Clicker 导出的 JSON。");
  }
  const stored = await readRules().catch(() => { throw new Error("无法读取现有规则，请重试。"); });
  const entries = planRuleImport(stored, sites);
  return {
    backup,
    entries,
    added: entries.reduce((count, entry) => count + entry.added.length, 0),
    duplicates: entries.reduce((count, entry) => count + entry.duplicates, 0)
  };
}
