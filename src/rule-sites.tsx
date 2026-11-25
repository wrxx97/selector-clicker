import { memo, useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { changePause, siteClickCountsKey, siteLastClickTimesKey } from "@/lib/extension";
import { useRulesStore } from "@/lib/rules-store";
import type { ToastFeedback } from "@/components/ui/toast";
import type { PauseOptions, Rule, RuleSite } from "@/lib/extension-types";
import type { OpenManagerDialog } from "./rule-dialogs";

const count = new Intl.NumberFormat("zh-CN");
const clickTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

interface RuleRowProps {
  hostname: string;
  rule: Rule;
  busy: boolean;
  onPause(options: PauseOptions): Promise<void>;
  openDialog: OpenManagerDialog;
}

function ruleStat(group: unknown, key: string) {
  if (!group || typeof group !== "object") return undefined;
  const value = (group as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}

const RuleRow = memo(function RuleRow({ hostname, rule, busy, onPause, openDialog }: RuleRowProps) {
  const conditions = [
    rule.pathPrefix && `路径 ${rule.pathPrefix}`,
    rule.maxClicks && `每页最多 ${rule.maxClicks} 次`
  ].filter(Boolean).join(" · ");
  const statsKey = `rule:${rule.id}`;
  const { loaded, clicks, clickedAt } = useRulesStore(useShallow(({ stats }) => ({
    loaded: stats !== null,
    clicks: ruleStat(stats?.[siteClickCountsKey(hostname)], statsKey) ?? 0,
    clickedAt: ruleStat(stats?.[siteLastClickTimesKey(hostname)], statsKey)
  })));
  const lastClick = new Date(clickedAt ?? NaN);
  return <li data-paused={rule.paused}
    className="grid gap-2 px-4 py-2.5 data-[paused=true]:bg-paused sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="grid min-w-0 gap-0.5">
      {rule.name && <strong className="break-all text-sm">{rule.name}</strong>}
      <code className="break-all text-xs text-muted-foreground">{rule.selector}</code>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {conditions && <span className="break-all">{conditions}</span>}
        {loaded && <span className="tabular-nums">上次点击{" "}
          {Number.isFinite(lastClick.getTime())
            ? <time dateTime={lastClick.toISOString()}>{clickTime.format(lastClick)}</time>
            : "暂无记录"}
        </span>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-0.5 sm:justify-end">
      <Badge variant="secondary" className="mr-1 tabular-nums" title="本机累计点击次数">
        {loaded ? `${count.format(clicks)} 次` : "—"}
      </Badge>
      <Button size="sm" variant="ghost" disabled={busy}
        aria-label={`${rule.paused ? "恢复" : "暂停"}规则 ${rule.name || rule.selector}`}
        onClick={() => onPause({ selector: rule.selector, expectedId: rule.id, paused: !rule.paused })}>
        {rule.paused ? "恢复" : "暂停"}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} aria-label={`编辑规则 ${rule.name || rule.selector}`}
        onClick={(event) => openDialog({ kind: "rule", hostname, rule, remove: false }, event.currentTarget)}>编辑</Button>
      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} aria-label={`移除规则 ${rule.name || rule.selector}`}
        onClick={(event) => openDialog({ kind: "rule", hostname, rule, remove: true }, event.currentTarget)}>移除</Button>
    </div>
  </li>;
});

interface RulesListProps {
  openDialog: OpenManagerDialog;
  setFeedback(feedback: ToastFeedback | null): void;
}

interface SiteGroupProps extends RulesListProps {
  site: RuleSite;
  visibleRules: Rule[];
}

const SiteGroup = memo(function SiteGroup({ site, visibleRules, openDialog, setFeedback }: SiteGroupProps) {
  const { hostname, paused } = site;
  const [busy, setBusy] = useState(false);

  const pause = useCallback(async (options: PauseOptions) => {
    setBusy(true);
    setFeedback(null);
    try {
      await changePause(hostname, options);
      await useRulesStore.getState().loadRules();
      if (options.selector === undefined) {
        setFeedback({ text: options.paused ? "已暂停全部规则。" : "已恢复全部规则。" });
      }
    } catch {
      setFeedback({ text: "无法修改暂停状态，请重试。", error: true });
    } finally {
      setBusy(false);
    }
  }, [hostname, setFeedback]);

  return <Card className="gap-0 overflow-hidden py-0 shadow-xs">
    <header className="flex flex-wrap items-center justify-between gap-2 bg-muted/70 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="break-all text-sm font-semibold">{hostname}</h2>
        <Badge variant="secondary">{site.rules.length} 条规则</Badge>
        {paused && <Badge variant="outline">全部规则已暂停</Badge>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => pause({ paused: !paused })}>
          {paused ? "恢复站点" : "暂停站点"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={(event) => openDialog({ kind: "site", site, remove: false }, event.currentTarget)}>编辑站点</Button>
        <Button size="sm" variant="destructive" disabled={busy}
          onClick={(event) => openDialog({ kind: "site", site, remove: true }, event.currentTarget)}>删除站点规则</Button>
      </div>
    </header>
    <ul className="divide-y border-t">
      {visibleRules.map((rule) => <RuleRow key={rule.id} hostname={hostname} rule={rule} busy={busy}
        onPause={pause} openDialog={openDialog} />)}
    </ul>
  </Card>;
});

export const RulesList = memo(function RulesList({ openDialog, setFeedback }: RulesListProps) {
  const { sites, search, loadError } = useRulesStore(useShallow((state) => ({
    sites: state.sites, search: state.search, loadError: state.loadError
  })));
  const query = search.trim().toLowerCase();
  const groups = useMemo(() => (sites || []).flatMap((site) => {
    if (!query || site.hostname.includes(query)) return [{ site, visibleRules: site.rules }];
    const rules = site.rules.filter(({ selector, name }) =>
      selector.toLowerCase().includes(query) || name.toLowerCase().includes(query));
    return rules.length ? [{ site, visibleRules: rules.length === site.rules.length ? site.rules : rules }] : [];
  }), [sites, query]);
  const total = groups.reduce((sum, { visibleRules }) => sum + visibleRules.length, 0);

  return <>
    <p id="rule-summary" role="status" className="text-xs text-muted-foreground">
      {sites ? `${query ? "找到 " : ""}${groups.length} 个网站 · ${total} 条规则`
        : loadError ? "规则暂不可用" : "正在读取规则…"}
    </p>
    {groups.length > 0 && <section className="grid gap-3" aria-label="站点规则">
      {groups.map(({ site, visibleRules }) => <SiteGroup key={site.hostname} site={site} visibleRules={visibleRules}
        setFeedback={setFeedback} openDialog={openDialog} />)}
    </section>}
    {sites && !groups.length && <Card className="gap-1.5 px-4 py-8 text-center shadow-xs">
      <h2 className="font-semibold">{sites.length ? "没有匹配的规则" : "还没有站点规则"}</h2>
      <p className="text-sm text-muted-foreground">{sites.length
        ? "试试其他网站名称、备注或选择器。" : "在目标网页打开扩展弹窗，点击「授权并选取元素」添加第一条规则。"}</p>
    </Card>}
  </>;
});
