import { memo, useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { changePause, send, siteClickCountsKey, siteLastClickTimesKey } from "@/lib/extension";
import { useTranslation } from "react-i18next";
import { translate, useLanguageStore } from "@/lib/i18n";
import { useRulesStore } from "./store";
import type { ToastFeedback } from "@/components/ui/toast";
import type { HideRule, ManagedRuleSite, PauseOptions, Rule } from "@/lib/extension-types";
import type { OpenManagerDialog } from "./dialogs";

const timeOptions: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
};
const clickTime = {
  en: new Intl.DateTimeFormat("en", timeOptions),
  "zh-CN": new Intl.DateTimeFormat("zh-CN", timeOptions)
};

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
  const { t } = useTranslation();
  const locale = useLanguageStore((state) => state.locale);
  const conditions = [
    rule.pathPrefix && t("rulePath", { path: rule.pathPrefix }),
    rule.maxClicks && t("ruleClickLimit", { limit: rule.maxClicks })
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
        {loaded && <span className="tabular-nums">{t("lastClick")}{" "}
          {Number.isFinite(lastClick.getTime())
            ? <time dateTime={lastClick.toISOString()}>{clickTime[locale].format(lastClick)}</time>
            : t("noClicksRecorded")}
        </span>}
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-0.5 sm:justify-end">
      <Badge variant="secondary" className="mr-1 tabular-nums" title={t("clicksOnDevice")}>
        {loaded ? t("clicks", { count: clicks }) : "—"}
      </Badge>
      <Button size="sm" variant="ghost" disabled={busy}
        aria-label={t(rule.paused ? "resumeRule" : "pauseRule", { label: rule.name || rule.selector })}
        onClick={() => onPause({ selector: rule.selector, expectedId: rule.id, paused: !rule.paused })}>
        {rule.paused ? t("resume") : t("pause")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} aria-label={t("editRuleLabel", { label: rule.name || rule.selector })}
        onClick={(event) => openDialog({ kind: "rule", hostname, rule, remove: false }, event.currentTarget)}>{t("edit")}</Button>
      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} aria-label={t("removeRule", { label: rule.name || rule.selector })}
        onClick={(event) => openDialog({ kind: "rule", hostname, rule, remove: true }, event.currentTarget)}>{t("remove")}</Button>
    </div>
  </li>;
});

const HideRuleRow = memo(function HideRuleRow({ hostname, rule, busy, onPause, openDialog }: {
  hostname: string;
  rule: HideRule;
  busy: boolean;
  onPause(rule: HideRule): Promise<void>;
  openDialog: OpenManagerDialog;
}) {
  const { t } = useTranslation();
  const label = rule.name || rule.selector;
  return <li data-paused={rule.paused}
    className="grid gap-2 px-4 py-2.5 data-[paused=true]:bg-paused sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
    <div className="grid min-w-0 gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t("autoHide")}</Badge>
        {rule.name && <strong className="break-all text-sm">{rule.name}</strong>}
      </div>
      <code className="break-all text-xs text-muted-foreground">{rule.selector}</code>
      {rule.contains && <p className="break-all text-xs text-muted-foreground">
        {t("hideWhenContains", {
          condition: rule.contains.text ? `${rule.contains.selector} · “${rule.contains.text}”` : rule.contains.selector
        })}
      </p>}
    </div>
    <div className="flex flex-wrap items-center gap-0.5 sm:justify-end">
      <Button size="sm" variant="ghost" disabled={busy} aria-label={t(rule.paused ? "resumeRule" : "pauseRule", { label })}
        onClick={() => onPause(rule)}>{t(rule.paused ? "resume" : "pause")}</Button>
      <Button size="sm" variant="ghost" disabled={busy} aria-label={t("editRuleLabel", { label })}
        onClick={(event) => openDialog({ kind: "hide-rule", hostname, rule, remove: false }, event.currentTarget)}>{t("edit")}</Button>
      <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} aria-label={t("removeRule", { label })}
        onClick={(event) => openDialog({ kind: "hide-rule", hostname, rule, remove: true }, event.currentTarget)}>{t("remove")}</Button>
    </div>
  </li>;
});

interface RulesListProps {
  openDialog: OpenManagerDialog;
  setFeedback(feedback: ToastFeedback | null): void;
}

interface SiteGroupProps extends RulesListProps {
  site: ManagedRuleSite;
  visibleRules: Rule[];
  visibleHideRules: HideRule[];
}

const SiteGroup = memo(function SiteGroup({ site, visibleRules, visibleHideRules, openDialog, setFeedback }: SiteGroupProps) {
  const { t } = useTranslation();
  const { hostname, paused } = site;
  const [busy, setBusy] = useState(false);

  const runPause = useCallback(async (action: () => Promise<unknown>, feedback?: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      await useRulesStore.getState().loadRules();
      if (feedback) setFeedback({ text: feedback });
    } catch {
      setFeedback({ text: translate("pauseError"), error: true });
    } finally {
      setBusy(false);
    }
  }, [setFeedback]);
  const pause = useCallback((options: PauseOptions) => runPause(() => changePause(hostname, options)),
    [hostname, runPause]);
  const pauseHide = useCallback((rule: HideRule) => runPause(async () => {
    const result = await send({ type: "set-hide-rule-paused", hostname, id: rule.id, paused: !rule.paused });
    if (!result?.ok) throw new Error("Could not pause hide rule");
  }), [hostname, runPause]);
  const pauseSite = () => runPause(async () => {
    const result = await send({ type: "set-managed-site-paused", hostname, paused: !paused });
    if (!result?.ok) throw new Error("Could not pause site rules");
  }, t(paused ? "allResumed" : "allPaused"));

  return <Card className="gap-0 overflow-hidden py-0 shadow-xs">
    <header className="flex flex-wrap items-center justify-between gap-2 bg-muted/70 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className="break-all text-sm font-semibold">{hostname}</h2>
        <Badge variant="secondary">{t("rules", { count: site.rules.length + site.hideRules.length })}</Badge>
        {paused && <Badge variant="outline">{t("allRulesPaused")}</Badge>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" disabled={busy} onClick={pauseSite}>
          {paused ? t("resumeCurrentSite") : t("pauseCurrentSite")}
        </Button>
        <Button size="sm" variant="outline" disabled={busy}
          onClick={(event) => openDialog({ kind: "site", site, remove: false }, event.currentTarget)}>{t("editSite")}</Button>
        <Button size="sm" variant="destructive" disabled={busy}
          onClick={(event) => openDialog({ kind: "site", site, remove: true }, event.currentTarget)}>{t("deleteSiteRules")}</Button>
      </div>
    </header>
    {visibleRules.length > 0 && <ul className="divide-y border-t" aria-label={t("autoClick")}>
      {visibleRules.map((rule) => <RuleRow key={rule.id} hostname={hostname} rule={rule} busy={busy}
        onPause={pause} openDialog={openDialog} />)}
    </ul>}
    {visibleHideRules.length > 0 && <ul data-hide-rules className="divide-y border-t" aria-label={t("autoHide")}>
      {visibleHideRules.map((rule) => <HideRuleRow key={rule.id} hostname={hostname} rule={rule} busy={busy}
        onPause={pauseHide} openDialog={openDialog} />)}
    </ul>}
  </Card>;
});

export const RulesList = memo(function RulesList({ openDialog, setFeedback }: RulesListProps) {
  const { t } = useTranslation();
  const { sites, search, loadError } = useRulesStore(useShallow((state) => ({
    sites: state.sites, search: state.search, loadError: state.loadError
  })));
  const query = search.trim().toLowerCase();
  const groups = useMemo(() => (sites || []).flatMap((site) => {
    if (!query || site.hostname.includes(query)) return [{ site, visibleRules: site.rules, visibleHideRules: site.hideRules }];
    const matches = (...fields: (string | undefined)[]) => fields.some((field) => field?.toLowerCase().includes(query));
    const rules = site.rules.filter(({ selector, name }) => matches(selector, name));
    const hidden = site.hideRules.filter(({ selector, name, contains }) =>
      matches(selector, name, contains?.selector, contains?.text));
    return rules.length || hidden.length ? [{
      site, visibleRules: rules.length === site.rules.length ? site.rules : rules,
      visibleHideRules: hidden.length === site.hideRules.length ? site.hideRules : hidden
    }] : [];
  }), [sites, query]);
  const total = groups.reduce((sum, { visibleRules, visibleHideRules }) => sum + visibleRules.length + visibleHideRules.length, 0);

  return <>
    <p id="rule-summary" role="status" className="text-xs text-muted-foreground">
      {sites ? t(query ? "rulesSearchSummary" : "rulesSummary", {
          sites: t("sites", { count: groups.length }),
          rules: t("rules", { count: total })
        })
        : loadError ? t("rulesUnavailable") : t("rulesLoading")}
    </p>
    {groups.length > 0 && <section className="grid gap-3" aria-label={t("siteRules")}>
      {groups.map(({ site, visibleRules, visibleHideRules }) => <SiteGroup key={site.hostname} site={site}
        visibleRules={visibleRules} visibleHideRules={visibleHideRules} setFeedback={setFeedback} openDialog={openDialog} />)}
    </section>}
    {sites && !groups.length && <Card className="gap-1.5 px-4 py-8 text-center shadow-xs">
      <h2 className="font-semibold">{sites.length ? t("noMatchingRules") : t("noSiteRules")}</h2>
      <p className="text-sm text-muted-foreground">{sites.length
        ? t("tryAnotherSearch") : t("addFirstRule")}</p>
    </Card>}
  </>;
});
