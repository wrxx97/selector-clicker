import { createRuleBackup, getManagedRuleSites, parseRuleBackup, planRuleImport, readRules } from "./extension";
import { translate as t } from "./i18n";
import type { ImportSite, ManagedRuleSite } from "./extension-types";

export const MAX_BACKUP_BYTES = 1024 * 1024;

export function formatRuleBackup(sites: ManagedRuleSite[]) {
  return JSON.stringify(createRuleBackup(sites), null, 2) + "\n";
}

export async function exportRuleFile() {
  const file = new Blob([formatRuleBackup(getManagedRuleSites(await readRules()))], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "selector-clicker-rules.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function validateSelector(selector: string) {
  if (!selector.trim()) return t("selectorRequired");
  try {
    document.createDocumentFragment().querySelector(selector);
    return "";
  } catch {
    return t("invalidSelector");
  }
}

export interface BackupPreview {
  backup: unknown;
  entries: ImportSite[];
  added: number;
  duplicates: number;
}

export async function previewRuleImport(text: string): Promise<BackupPreview> {
  const input = text.trim();
  if (!input) throw new Error(t("backupRequired"));
  if (new Blob([input]).size > MAX_BACKUP_BYTES) throw new Error(t("backupTooLarge"));
  let backup: unknown;
  try {
    backup = JSON.parse(input);
  } catch {
    throw new Error(t("invalidJson"));
  }
  let sites: ReturnType<typeof parseRuleBackup>;
  try {
    sites = parseRuleBackup(backup, (selector) => !validateSelector(selector));
  } catch {
    throw new Error(t("invalidBackup"));
  }
  const stored = await readRules().catch(() => { throw new Error(t("readRulesError")); });
  const entries = planRuleImport(stored, sites);
  return {
    backup,
    entries,
    added: entries.reduce((count, entry) => count + entry.added.length + entry.addedHideRules.length, 0),
    duplicates: entries.reduce((count, entry) => count + entry.duplicates, 0)
  };
}
