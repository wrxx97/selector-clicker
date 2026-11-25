import { memo, useCallback, useId, useRef, useState } from "react";
import { Ellipsis, Pause, Play, RotateCw, ShieldCheck } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Rule } from "@/lib/extension-types";
import { usePopupStore } from "./store";

interface RuleRowProps {
  rule: Rule;
  expanded: boolean;
  authorized: boolean;
  busy: boolean;
  setExpanded(id: string, open: boolean): void;
}

const RuleRow = memo(function RuleRow({ rule, expanded, authorized, busy, setExpanded }: RuleRowProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const actionsId = useId();
  const label = rule.name || rule.selector;
  const expand = (open: boolean) => setExpanded(rule.id, open);

  return <li className="popup-rule relative isolate flex min-h-9 min-w-0 items-center rounded-lg border bg-muted/60 py-[3px] pr-9 pl-2"
    data-expanded={expanded} data-paused={rule.paused}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") expand(true); }}
    onPointerLeave={(event) => {
      if (event.pointerType !== "mouse") return;
      const focused = document.activeElement;
      if (focused && event.currentTarget.contains(focused) && focused.matches(":focus-visible")) return;
      expand(false);
    }}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(":hover")) expand(false);
    }}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || !expanded) return;
      event.preventDefault();
      event.stopPropagation();
      trigger.current?.focus();
      expand(false);
    }}>
    <div className="min-w-0">
      {rule.name && <strong className="block truncate text-xs leading-3.5" title={rule.name}>{rule.name}</strong>}
      <code className="block truncate text-xs leading-3.5 text-muted-foreground" title={rule.selector}>{rule.selector}</code>
    </div>
    <Button ref={trigger} type="button" size="icon-xs" variant="outline" className="absolute top-1/2 right-1.5 z-10 -translate-y-1/2 border-input bg-card text-primary"
      aria-label={`${expanded ? "收起" : "显示"}规则操作 ${label}`} aria-expanded={expanded}
      aria-controls={actionsId} title={expanded ? "收起操作" : "规则操作"} onClick={() => expand(!expanded)}>
      <Ellipsis />
    </Button>
    <div id={actionsId} className="popup-rule-actions" role="group" aria-label={`规则操作 ${label}`} inert={!expanded}>
      <Button size="xs" variant="secondary" disabled={!authorized} aria-disabled={busy || undefined}
        aria-label={`测试规则 ${label}`} onClick={() => usePopupStore.getState().diagnose(rule)}>测试</Button>
      <Button size="xs" variant="outline" className="bg-card text-primary" aria-disabled={busy || undefined}
        aria-label={`${rule.paused ? "恢复" : "暂停"}规则 ${label}`}
        onClick={() => usePopupStore.getState().pause({ selector: rule.selector, expectedId: rule.id, paused: !rule.paused })}>
        {rule.paused ? "恢复" : "暂停"}
      </Button>
      <Button size="xs" variant="outline" className="bg-card text-primary" aria-disabled={busy || undefined}
        aria-label={`重新选取规则 ${label}`} onClick={() => usePopupStore.getState().pick(rule)}>重新选取</Button>
      <Button size="xs" variant="destructive" aria-disabled={busy || undefined}
        aria-label={`移除规则 ${label}`} onClick={() => usePopupStore.getState().remove(rule)}>移除</Button>
    </div>
  </li>;
});

const RuleToolbar = memo(function RuleToolbar({ count, paused }: { count: number; paused: boolean }) {
  const { initialized, authorized, connected, busy, settingsBusy, pause, scan, authorize } = usePopupStore(useShallow((state) => ({
    initialized: state.initialized, authorized: state.authorized, connected: state.connected, busy: state.siteBusy,
    settingsBusy: state.settingsBusy,
    pause: state.pause, scan: state.scan, authorize: state.authorize
  })));
  return <div className="flex flex-wrap items-center gap-1.5">
    <Badge variant="secondary">{count} 条规则</Badge>
    <div className="flex items-center gap-1.5">
      {count > 0 && <Button id="pause-site" size="sm" variant="outline" className="border-input text-primary" disabled={busy}
        onClick={() => pause({ paused: !paused })}>
        {paused ? <Play /> : <Pause />} {paused ? "恢复当前站点" : "暂停当前站点"}
      </Button>}
      <Button id="scan-now" size="sm" variant="outline" className="border-input text-primary"
        disabled={!initialized || !connected || busy || settingsBusy} onClick={scan}>
        <RotateCw /> 立即扫描
      </Button>
    </div>
    {count > 0 && !authorized && <Button id="authorize-site" size="sm" variant="outline" disabled={busy} onClick={authorize}>
      <ShieldCheck /> 授权当前站点
    </Button>}
  </div>;
});

export function RuleList() {
  const { site, rules, authorized, busy } = usePopupStore(useShallow((state) => ({
    site: state.site, rules: state.rules, authorized: state.authorized, busy: state.siteBusy
  })));
  const [open, setOpen] = useState<string | null>(null);
  const setExpanded = useCallback((id: string, expanded: boolean) => {
    setOpen((current) => expanded ? id : current === id ? null : current);
  }, []);

  if (!site) return null;
  return <section aria-label="站点规则" className="grid gap-2 border-t pt-2.5">
    <RuleToolbar count={rules.length} paused={rules.every((rule) => rule.paused)} />
    {rules.length > 0 && <ul id="site-rule-list" className="popup-rule-list grid max-h-[12.5rem] grid-cols-1 gap-1 overflow-x-hidden overflow-y-auto pr-0.5">
      {rules.map((rule) => <RuleRow key={rule.id} rule={rule} expanded={open === rule.id}
        authorized={authorized} busy={busy} setExpanded={setExpanded} />)}
    </ul>}
  </section>;
}
