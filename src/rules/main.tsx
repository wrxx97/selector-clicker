import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { BrandIcon } from "@/components/ui/brand-icon";
import { ClipboardCopy, ClipboardPaste, Download, MousePointer2, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toast, useToast, type ToastFeedback } from "@/components/ui/toast";
import { MAX_BACKUP_BYTES, exportRuleFile, formatRuleBackup, previewRuleImport } from "@/lib/backup";
import { TOTAL_CLICK_COUNT_KEY } from "@/lib/extension";
import { startRules, useRulesStore } from "./store";
import { startTheme } from "@/lib/theme";
import { BackupDialog, EditorDialog, SiteDialog, type ManagerDialog, type OpenManagerDialog } from "./dialogs";
import { CooldownSettings } from "./settings";
import { RulesList } from "./sites";
import { ThemeSettings } from "./theme-settings";
import "../styles/theme.css";

const Settings = memo(CooldownSettings);

const ManagerHeader = memo(function ManagerHeader() {
  const total = useRulesStore(({ stats }) => stats === null ? null : Number(stats[TOTAL_CLICK_COUNT_KEY]) || 0);
  return <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-linear-to-br from-banner-start to-banner-end px-4 py-4 sm:px-6">
    <BrandIcon size={48} />
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold text-muted-foreground">Selector Clicker</p>
      <h1 className="mt-0.5 text-2xl font-bold tracking-tight">规则管理</h1>
    </div>
    <div className="grid justify-items-end gap-0.5 rounded-xl border border-border bg-card/80 px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><MousePointer2 size={13} />本机累计点击</span>
      <strong id="total-clicks" className="text-xl leading-tight font-bold text-primary tabular-nums">
        {total === null ? "—" : total.toLocaleString("zh-CN")}
      </strong>
    </div>
  </header>;
});

const RuleSearch = memo(function RuleSearch({ searchInput }: { searchInput: RefObject<HTMLInputElement | null> }) {
  const search = useRulesStore((state) => state.search);
  const setSearch = useRulesStore((state) => state.setSearch);
  return <div className="relative w-full sm:w-72">
    <Search size={15} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
    <Input ref={searchInput} id="rule-search" type="search" className="bg-card pl-8"
      value={search} onChange={(event) => setSearch(event.target.value)} spellCheck={false}
      aria-label="搜索网站、备注或选择器" placeholder="搜索网站、备注或选择器" />
  </div>;
});

const BackupActions = memo(function BackupActions({ openDialog, setFeedback }: {
  openDialog: OpenManagerDialog;
  setFeedback(feedback: ToastFeedback): void;
}) {
  const loaded = useRulesStore((state) => state.sites !== null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const fileButton = useRef<HTMLButtonElement>(null);

  async function copyBackup() {
    const { sites } = useRulesStore.getState();
    if (!sites) return;
    try {
      await navigator.clipboard.writeText(formatRuleBackup(sites));
      setFeedback({ text: "规则 JSON 已复制到剪贴板。" });
    } catch {
      setFeedback({ text: "无法复制规则，请重试或导出文件。", error: true });
    }
  }

  async function exportBackup() {
    setBusy(true);
    try {
      await exportRuleFile();
      setFeedback({ text: "已导出规则备份。" });
    } catch {
      setFeedback({ text: "无法导出规则，请重试。", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function openFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = "";
    if (!selected) return;
    setBusy(true);
    try {
      if (selected.size > MAX_BACKUP_BYTES) throw new Error("规则文件不能超过 1 MB。");
      const text = await selected.text().catch(() => { throw new Error("无法读取规则文件，请重试。"); });
      const preview = await previewRuleImport(text);
      openDialog({ kind: "backup", source: { type: "file", preview } }, fileButton.current);
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "无法导入规则文件，请重试。", error: true });
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-wrap gap-1.5" aria-label="规则备份">
    <Button ref={fileButton} id="import-rules" size="sm" variant="outline" disabled={Boolean(busy)}
      onClick={() => file.current?.click()}><Upload /> 导入文件</Button>
    <Button id="paste-rules" size="sm" variant="outline" disabled={Boolean(busy)}
      onClick={(event) => { openDialog({ kind: "backup", source: { type: "text" } }, event.currentTarget); }}>
      <ClipboardPaste /> 粘贴 JSON
    </Button>
    <Button id="export-rules" size="sm" variant="outline" disabled={Boolean(busy)} onClick={exportBackup}>
      <Download /> 导出文件
    </Button>
    <Button id="copy-rules" size="sm" variant="secondary" disabled={!loaded} onClick={copyBackup}>
      <ClipboardCopy /> 复制规则 JSON
    </Button>
    <input ref={file} id="backup-file" type="file" accept=".json,application/json" hidden onChange={openFile} />
  </div>;
});

function RulesLoadFeedback({ setFeedback }: { setFeedback(feedback: ToastFeedback): void }) {
  const loadError = useRulesStore((state) => state.loadError);
  useEffect(() => {
    if (loadError) setFeedback({ text: "无法读取站点规则，请重新打开此页面。", error: true });
  }, [loadError, setFeedback]);
  return null;
}

function RuleManager() {
  const { feedback, setFeedback, dismiss } = useToast();
  const [dialog, setDialog] = useState<ManagerDialog | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLElement>(null);

  useEffect(startTheme, []);
  useEffect(startRules, []);
  const openDialog = useCallback<OpenManagerDialog>((next, button) => {
    trigger.current = button;
    setDialog(next);
  }, []);
  const close = () => setDialog(null);

  function focusTrigger(event: Event) {
    event.preventDefault();
    const target = trigger.current?.isConnected ? trigger.current : searchInput.current;
    target?.focus();
  }

  async function showSaved(message: string) {
    await useRulesStore.getState().loadRules();
    close();
    setFeedback({ text: message });
  }

  const dialogProps = { onClose: close, onSaved: showSaved, returnFocus: focusTrigger };
  return <main className="mx-auto grid max-w-5xl gap-4 px-4 py-5 sm:px-6 sm:py-9">
    <ManagerHeader />
    <ThemeSettings setFeedback={setFeedback} />
    <Settings setFeedback={setFeedback} dismiss={dismiss} />
    <section aria-label="搜索和备份" className="flex flex-wrap items-center justify-between gap-2">
      <RuleSearch searchInput={searchInput} />
      <BackupActions openDialog={openDialog} setFeedback={setFeedback} />
    </section>
    <RulesList openDialog={openDialog} setFeedback={setFeedback} />
    <RulesLoadFeedback setFeedback={setFeedback} />
    {dialog?.kind === "rule" && <EditorDialog action={dialog} {...dialogProps} />}
    {dialog?.kind === "site" && <SiteDialog action={dialog} {...dialogProps} />}
    {dialog?.kind === "backup" && <BackupDialog source={dialog.source} {...dialogProps} />}
    <Toast feedback={feedback} dismiss={dismiss} />
  </main>;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<RuleManager />);
