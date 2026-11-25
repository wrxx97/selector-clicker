export interface Rule {
  id: string;
  selector: string;
  name: string;
  paused: boolean;
  pathPrefix: string;
  maxClicks: number;
}

export interface RuleSite {
  hostname: string;
  paused: boolean;
  rules: Rule[];
}

export interface ActiveSite {
  id: number;
  hostname: string;
  pattern: string;
}

export type PauseOptions = { paused: boolean; selector?: never; expectedId?: never }
  | { paused: boolean; selector: string; expectedId: string };
export type StorageChanges = Record<string, chrome.storage.StorageChange>;
export type StoredValues = Record<string, unknown>;

type BackupRule = Omit<Rule, "id">;
export type BackupSite = Omit<RuleSite, "rules"> & { rules: BackupRule[] };
export interface RuleBackup {
  format: string;
  version: number;
  sites: BackupSite[];
}

export type ImportSite = BackupSite & { existing: Rule[]; added: BackupRule[]; duplicates: number };

export type RuleTestStatus =
  | "ready" | "missing" | "removed" | "hidden" | "disabled" | "cooldown" | "invalid"
  | "ambiguous" | "site-paused" | "rule-paused" | "out-of-scope" | "limit-reached";

export type PageRequest =
  | { type: "get-status" | "scan-now" }
  | { type: "test-rule"; selector: string }
  | { type: "start-picker"; selector?: string; expectedId?: string };

export interface PageResponses {
  "get-status": { authorized: boolean; enabled: boolean; totalClicks: number };
  "scan-now": { totalClicks: number };
  "test-rule": { status: RuleTestStatus; count?: number };
  "start-picker": { ok: boolean };
}

export type WorkerRequest =
  | { type: "authorize-site"; pattern: string }
  | { type: "set-site-paused"; hostname: string; paused: boolean }
  | { type: "rename-site"; hostname: string; destination: string; expectedRuleIds: string[] }
  | { type: "remove-site-rules"; hostname: string; expectedRuleIds: string[] }
  | { type: "set-rule-paused"; hostname: string; selector: string; expectedId: string; paused: boolean }
  | { type: "remove-site-selector"; hostname: string; selector: string; expectedId?: string }
  | { type: "edit-site-selector"; hostname: string; selector: string; expectedId: string; replacement: string; name: string; pathPrefix: string; maxClicks: number }
  | { type: "import-rules"; backup: unknown };

export interface WorkerResponse {
  ok: boolean;
  reason?: string;
  addedCount?: number;
  duplicateCount?: number;
}
