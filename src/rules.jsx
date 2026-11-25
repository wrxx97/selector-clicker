import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClipboardCopy, ClipboardPaste, Download, MousePointer2, Search, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Toast, useToast } from "@/components/ui/toast";
import { MAX_BACKUP_BYTES, exportRuleFile, formatRuleBackup, previewRuleImport } from "@/lib/backup";
import {
  TOTAL_CLICK_COUNT_KEY, changePause, isRuleChange, listenToStorage, siteClickCountsKey, siteLastClickTimesKey
} from "@/lib/extension";
import { useRulesStore } from "@/lib/rules-store";
import { BackupDialog, EditorDialog } from "./rule-dialogs.jsx";
import { CooldownSettings } from "./rule-settings";
import "./theme.css";

const count = new Intl.NumberFormat("zh-CN");
const clickTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function SiteGroup({ hostname, rules, paused, stats, busy, onPause, onEdit }) {
  return <Card className="gap-0 overflow-hidden py-0 shadow-xs">
    <header className="flex flex-wrap items-center justify-between gap-2 bg-muted/70 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="break-all text-sm font-semibold">{hostname}</h2>
        <Badge variant="secondary">{rules.length} 条规则</Badge>
        {paused && <Badge variant="outline">全部规则已暂停</Badge>}
      </div>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onPause(hostname, { paused: !paused })}>
        {paused ? "恢复站点" : "暂停站点"}
      </Button>
    </header>
    <ul className="divide-y border-t">
      {rules.map((rule) => {
        const conditions = [
          rule.pathPrefix && `路径 ${rule.pathPrefix}`,
          rule.maxClicks && `每页最多 ${rule.maxClicks} 次`
        ].filter(Boolean).join(" · ");
        const statsKey = `rule:${rule.id}`;
        const clicks = stats?.[siteClickCountsKey(hostname)]?.[statsKey] || 0;
        const lastClick = new Date(stats?.[siteLastClickTimesKey(hostname)]?.[statsKey] ?? NaN);
        return <li key={rule.id} data-paused={rule.paused}
          className="grid gap-2 px-4 py-2.5 data-[paused=true]:bg-red-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="grid min-w-0 gap-0.5">
            {rule.name && <strong className="break-all text-sm">{rule.name}</strong>}
            <code className="break-all text-xs text-muted-foreground">{rule.selector}</code>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {conditions && <span className="break-all">{conditions}</span>}
              {stats && <span className="tabular-nums">上次点击{" "}
                {Number.isFinite(lastClick.getTime())
                  ? <time dateTime={lastClick.toISOString()}>{clickTime.format(lastClick)}</time>
                  : "暂无记录"}
              </span>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-0.5 sm:justify-end">
            <Badge variant="secondary" className="mr-1 tabular-nums" title="本机累计点击次数">
              {stats ? `${count.format(clicks)} 次` : "—"}
            </Badge>
            <Button size="sm" variant="ghost" disabled={busy}
              aria-label={`${rule.paused ? "恢复" : "暂停"}规则 ${rule.name || rule.selector}`}
              onClick={() => onPause(hostname, { selector: rule.selector, expectedId: rule.id, paused: !rule.paused })}>
              {rule.paused ? "恢复" : "暂停"}
            </Button>
            <Button size="sm" variant="ghost" aria-label={`编辑规则 ${rule.name || rule.selector}`}
              onClick={(event) => onEdit(hostname, rule, false, event.currentTarget)}>编辑</Button>
            <Button size="sm" variant="ghost" className="text-destructive" aria-label={`移除规则 ${rule.name || rule.selector}`}
              onClick={(event) => onEdit(hostname, rule, true, event.currentTarget)}>移除</Button>
          </div>
        </li>;
      })}
    </ul>
  </Card>;
}

function RuleManager() {
  const { sites, stats, search, setSearch, loadRules, loadStats, loadError } = useRulesStore();
  const { feedback, setFeedback, dismiss } = useToast();
  const [busy, setBusy] = useState("");
  const [action, setAction] = useState(null);
  const [backup, setBackup] = useState(null);
  const file = useRef(null);
  const fileButton = useRef(null);
  const searchInput = useRef(null);
  const trigger = useRef(null);

  useEffect(() => {
    loadRules();
    loadStats();
    return listenToStorage((changes, area) => {
      if (area === "sync" && isRuleChange(changes)) loadRules();
      if (area === "local" && changes[TOTAL_CLICK_COUNT_KEY]) loadStats();
    });
  }, [loadRules, loadStats]);

  useEffect(() => {
    if (loadError) setFeedback({ text: "无法读取站点规则，请重新打开此页面。", error: true });
  }, [loadError, setFeedback]);

  const query = search.trim().toLowerCase();
  const groups = (sites || []).map((site) => ({
    ...site,
    rules: site.hostname.toLowerCase().includes(query) ? site.rules
      : site.rules.filter(({ selector, name }) => selector.toLowerCase().includes(query) || name.toLowerCase().includes(query))
  })).filter((site) => site.rules.length);
  const total = groups.reduce((sum, site) => sum + site.rules.length, 0);

  function focusTrigger(event) {
    event.preventDefault();
    const target = trigger.current?.isConnected ? trigger.current : searchInput.current;
    target?.focus();
  }

  function showSaved(message) {
    setAction(null);
    setBackup(null);
    setFeedback({ text: message });
    loadRules();
  }

  async function pause(hostname, options) {
    setBusy("pause");
    setFeedback(null);
    try {
      await changePause(hostname, options);
      await loadRules();
      if (options.selector === undefined) {
        setFeedback({ text: options.paused ? "已暂停全部规则。" : "已恢复全部规则。" });
      }
    } catch {
      setFeedback({ text: "无法修改暂停状态，请重试。", error: true });
    } finally {
      setBusy("");
    }
  }

  async function copyBackup() {
    if (!sites) return;
    try {
      await navigator.clipboard.writeText(formatRuleBackup(sites));
      setFeedback({ text: "规则 JSON 已复制到剪贴板。" });
    } catch {
      setFeedback({ text: "无法复制规则，请重试或导出文件。", error: true });
    }
  }

  async function exportBackup() {
    setBusy("export");
    try {
      await exportRuleFile();
      setFeedback({ text: "已导出规则备份。" });
    } catch {
      setFeedback({ text: "无法导出规则，请重试。", error: true });
    } finally {
      setBusy("");
    }
  }

  async function openFile(event) {
    const [selected] = event.target.files;
    event.target.value = "";
    if (!selected) return;
    setBusy("import");
    try {
      if (selected.size > MAX_BACKUP_BYTES) throw new Error("规则文件不能超过 1 MB。");
      const text = await selected.text().catch(() => { throw new Error("无法读取规则文件，请重试。"); });
      const preview = await previewRuleImport(text);
      trigger.current = fileButton.current;
      setBackup({ type: "file", preview });
    } catch (error) {
      setFeedback({ text: error.message, error: true });
    } finally {
      setBusy("");
    }
  }

  return <main className="mx-auto grid max-w-5xl gap-4 px-4 py-5 sm:px-6 sm:py-9">
    <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#cfe2fa] bg-linear-to-br from-[#eaf4ff] to-[#d6e9ff] px-4 py-4 sm:px-6">
      <img src="./icons/icon-48.png" alt="" width="48" height="48" className="shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-muted-foreground">Selector Clicker</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight">规则管理</h1>
      </div>
      <div className="grid justify-items-end gap-0.5 rounded-xl border border-white/90 bg-white/65 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><MousePointer2 size={13} />本机累计点击</span>
        <strong id="total-clicks" className="text-xl leading-tight font-bold text-primary tabular-nums">
          {stats ? count.format(stats[TOTAL_CLICK_COUNT_KEY] || 0) : "—"}
        </strong>
      </div>
    </header>
    <CooldownSettings setFeedback={setFeedback} dismiss={dismiss} />
    <section aria-label="搜索和备份" className="grid gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchInput} id="rule-search" type="search" className="bg-card pl-8"
            value={search} onChange={(event) => setSearch(event.target.value)} spellCheck={false}
            aria-label="搜索网站、备注或选择器" placeholder="搜索网站、备注或选择器" />
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="规则备份">
          <Button ref={fileButton} id="import-rules" size="sm" variant="outline" disabled={Boolean(busy)}
            onClick={() => file.current.click()}><Upload /> 导入文件</Button>
          <Button id="paste-rules" size="sm" variant="outline" disabled={Boolean(busy)}
            onClick={(event) => { trigger.current = event.currentTarget; setBackup({ type: "text" }); }}>
            <ClipboardPaste /> 粘贴 JSON
          </Button>
          <Button id="export-rules" size="sm" variant="outline" disabled={Boolean(busy)} onClick={exportBackup}>
            <Download /> 导出文件
          </Button>
          <Button id="copy-rules" size="sm" variant="secondary" disabled={!sites} onClick={copyBackup}>
            <ClipboardCopy /> 复制规则 JSON
          </Button>
          <input ref={file} id="backup-file" type="file" accept=".json,application/json" hidden onChange={openFile} />
        </div>
      </div>
      <p id="rule-summary" role="status" className="text-xs text-muted-foreground">
        {sites ? `${query ? "找到 " : ""}${groups.length} 个网站 · ${total} 条规则` : loadError ? "规则暂不可用" : "正在读取规则…"}
      </p>
    </section>
    {groups.length > 0 && <section className="grid gap-3" aria-label="站点规则">
      {groups.map((site) => <SiteGroup key={site.hostname} {...site} stats={stats} busy={Boolean(busy)} onPause={pause}
        onEdit={(hostname, rule, remove, button) => { trigger.current = button; setAction({ hostname, rule, remove }); }} />)}
    </section>}
    {sites && !groups.length && <Card className="gap-1.5 px-4 py-8 text-center shadow-xs">
      <h2 className="font-semibold">{sites.length ? "没有匹配的规则" : "还没有站点规则"}</h2>
      <p className="text-sm text-muted-foreground">{sites.length
        ? "试试其他网站名称、备注或选择器。" : "在目标网页打开扩展弹窗，点击「授权并选取元素」添加第一条规则。"}</p>
    </Card>}
    {action && <EditorDialog action={action} onClose={() => setAction(null)} onSaved={showSaved} returnFocus={focusTrigger} />}
    {backup && <BackupDialog source={backup} onClose={() => setBackup(null)} onSaved={showSaved} returnFocus={focusTrigger} />}
    <Toast feedback={feedback} dismiss={dismiss} />
  </main>;
}

createRoot(document.getElementById("root")).render(<RuleManager />);
