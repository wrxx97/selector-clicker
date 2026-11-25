import { useEffect, useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Crosshair, Ellipsis, LayoutList, Pause, Play, RotateCw, Save, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  changePause, connectToPage, isRuleChange, listenToStorage, openRules,
  requestSiteAccess, saveSettings, send, sendToPage, TOTAL_CLICK_COUNT_KEY
} from "@/lib/extension";
import { usePopupStore } from "@/lib/popup-store";
import "./theme.css";
import "./popup.css";

const diagnostics = {
  ready: "匹配到一个可点击元素，已在页面高亮。",
  missing: "当前页面没有匹配元素。",
  removed: "这条规则已移除或修改，请重新打开弹窗。",
  hidden: "匹配的元素不可见。",
  disabled: "匹配的元素不可点击。",
  cooldown: "匹配的元素仍在点击冷却中。",
  "site-paused": "当前站点已暂停。",
  "rule-paused": "这条规则已暂停。",
  "out-of-scope": "当前页面路径不在规则的生效范围内。",
  "limit-reached": "这条规则已达到本页点击上限。",
  invalid: "CSS 选择器格式无效。"
};

function Feedback({ id, value }) {
  return <p id={id} role="status" className={`text-xs leading-relaxed empty:hidden ${value?.error ? "text-destructive" : "text-muted-foreground"}`}>
    {value?.text}
  </p>;
}

function RuleRow({ rule, expanded, disabled, authorized, onExpand, onTest, onPause, onPick, onRemove }) {
  const trigger = useRef(null);
  const actionsId = useId();
  const label = rule.name || rule.selector;

  function leave(event) {
    if (event.pointerType !== "mouse") return;
    const focused = document.activeElement;
    if (event.currentTarget.contains(focused) && focused.matches(":focus-visible")) return;
    onExpand(false);
  }

  return <li className="popup-rule relative isolate flex min-h-9 min-w-0 items-center rounded-lg border bg-muted/60 py-[3px] pr-9 pl-2"
    data-expanded={expanded}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") onExpand(true); }}
    onPointerLeave={leave}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(":hover")) onExpand(false);
    }}
    onKeyDown={(event) => {
      if (event.key !== "Escape" || !expanded) return;
      event.preventDefault();
      event.stopPropagation();
      trigger.current?.focus();
      onExpand(false);
    }}>
    <div className="min-w-0">
      {rule.name && <strong className="block truncate text-xs leading-3.5" title={rule.name}>{rule.name}</strong>}
      <code className="block truncate text-xs leading-3.5 text-muted-foreground" title={rule.selector}>{rule.selector}</code>
    </div>
    <Button ref={trigger} type="button" size="icon-xs" variant="outline" className="absolute top-1/2 right-1.5 z-10 -translate-y-1/2 border-input bg-card text-primary"
      aria-label={`${expanded ? "收起" : "显示"}规则操作 ${label}`} aria-expanded={expanded}
      aria-controls={actionsId} title={expanded ? "收起操作" : "规则操作"} onClick={() => onExpand(!expanded)}>
      <Ellipsis />
    </Button>
    <div id={actionsId} className="popup-rule-actions" role="group" aria-label={`规则操作 ${label}`} inert={!expanded}>
      <Button size="xs" variant="secondary" disabled={!authorized} aria-disabled={disabled || undefined}
        aria-label={`测试规则 ${label}`} onClick={onTest}>测试</Button>
      <Button size="xs" variant="outline" className="bg-card text-primary" aria-disabled={disabled || undefined}
        aria-label={`${rule.paused ? "恢复" : "暂停"}规则 ${label}`} onClick={onPause}>
        {rule.paused ? "恢复" : "暂停"}
      </Button>
      <Button size="xs" variant="outline" className="bg-card text-primary" aria-disabled={disabled || undefined}
        aria-label={`重新选取规则 ${label}`} onClick={onPick}>重新选取</Button>
      <Button size="xs" variant="destructive" aria-disabled={disabled || undefined}
        aria-label={`移除规则 ${label}`} onClick={onRemove}>
        移除
      </Button>
    </div>
  </li>;
}

function Popup() {
  const popup = usePopupStore();
  const {
    site, initialized, authorized, connected, rules, sitePaused, enabled, cooldown, pageClicks, totalClicks, set
  } = popup;
  const supported = site?.id != null && Boolean(site.pattern);
  const [pageFeedback, setPageFeedback] = useState(null);
  const [settingsFeedback, setSettingsFeedback] = useState(null);
  const [busy, setBusy] = useState("");
  const [openRuleId, setOpenRuleId] = useState(null);
  const busyRef = useRef(false);

  useEffect(() => {
    const store = usePopupStore.getState();
    store.load().catch(() => setPageFeedback({ text: "无法读取扩展状态，请重新打开弹窗。", error: true }));
    store.loadTotal().catch(() => {});
    return listenToStorage((changes, area) => {
      if (area === "sync") {
        if (isRuleChange(changes)) store.loadRules().catch(() => {});
        if (changes.enabled) store.set({ enabled: changes.enabled.newValue ?? false });
        if (changes.cooldown) store.set({ cooldown: String(changes.cooldown.newValue ?? 8000) });
      }
      if (area === "local") {
        if (changes[TOTAL_CLICK_COUNT_KEY]) {
          store.set({ totalClicks: changes[TOTAL_CLICK_COUNT_KEY].newValue ?? 0 });
          const current = usePopupStore.getState();
          if (current.connected) sendToPage(current.site, { type: "get-status" })
            .then((status) => { if (status?.authorized) store.set({ pageClicks: status.totalClicks }); })
            .catch(() => {});
        }
        if (changes[globalThis.AUTHORIZED_SITES_KEY]) store.loadPage().catch(() => {});
      }
    });
  }, []);

  async function act(key, feedback, error, action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    feedback(null);
    try {
      await action();
    } catch {
      feedback({ text: error, error: true });
    } finally {
      busyRef.current = false;
      setBusy("");
    }
  }

  function startPicker(rule) {
    return act("picker", setPageFeedback, "无法进入选取模式，请刷新网页后重试。", async () => {
      if (!authorized && !await requestSiteAccess(site.pattern)) {
        setPageFeedback({ text: "未授予当前站点访问权限。" });
        return;
      }
      set({ authorized: true });
      await connectToPage(site);
      const editing = rule ? { selector: rule.selector, expectedId: rule.id } : {};
      const result = await sendToPage(site, { type: "start-picker", ...editing });
      if (!result?.ok) throw new Error("Could not start picker");
      window.close();
    });
  }

  function authorizeCurrentSite() {
    return act("authorize", setPageFeedback, "授权当前站点失败，请重试。", async () => {
      if (!await requestSiteAccess(site.pattern)) {
        setPageFeedback({ text: "未授予当前站点访问权限。" });
        return;
      }
      await popup.loadPage();
      setPageFeedback({ text: "已授权当前站点。" });
    });
  }

  function diagnose(rule) {
    return act("test", setPageFeedback, "无法测试此页面，请刷新后重试。", async () => {
      await connectToPage(site);
      const result = await sendToPage(site, { type: "test-rule", selector: rule.selector });
      if (!result) throw new Error("No diagnostic response");
      const text = result.status === "ambiguous"
        ? `匹配到 ${result.count} 个元素，请重新选取。` : diagnostics[result.status];
      setPageFeedback({ text });
    });
  }

  function pause(options) {
    return act("pause", setPageFeedback, "无法修改暂停状态，请重试。", async () => {
      await changePause(site.hostname, options);
      await popup.loadRules();
      setPageFeedback({ text: options.paused ? "已暂停自动点击。" : "已恢复自动点击。" });
    });
  }

  function remove(rule) {
    return act("remove", setPageFeedback, "移除失败，请重试。", async () => {
      const result = await send({ type: "remove-site-selector", hostname: site.hostname, selector: rule.selector });
      if (!result?.ok) throw new Error("Could not remove rule");
      await popup.loadRules();
    });
  }

  async function persist(nextEnabled) {
    const settings = await saveSettings(nextEnabled, cooldown);
    set({ enabled: settings.enabled, cooldown: String(settings.cooldown) });
  }

  function updateEnabled(nextEnabled) {
    return act("toggle", setSettingsFeedback, "保存设置失败，请重试。", async () => {
      await persist(nextEnabled);
    });
  }

  function scanNow() {
    return act("scan", setSettingsFeedback, "无法扫描此页面。", async () => {
      await persist(enabled);
      if (!enabled) {
        setSettingsFeedback({ text: "开启自动点击后即可扫描。" });
        return;
      }
      const result = await sendToPage(site, { type: "scan-now" });
      set({ pageClicks: result.totalClicks });
    });
  }

  const defaultFeedback = !initialized ? null : !supported
    ? { text: "请在普通网页上选取元素。" }
    : !authorized ? { text: "授权后可在当前站点选取元素和运行规则。" }
    : !connected ? { text: "无法连接当前网页，请刷新后重试。", error: true } : null;
  const disabled = Boolean(busy);

  return <main className="grid w-96 max-w-full gap-3 p-3.5 text-sm">
    <header className="flex items-center gap-3 rounded-2xl border border-[#cfe2fa] bg-linear-to-br from-[#eaf4ff] to-[#d6e9ff] px-3.5 py-3">
      <img src="./icons/icon-48.png" alt="" width="40" height="40" className="shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <h1 className="text-base font-bold tracking-tight">元素自动点击</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`size-1.5 rounded-full ${enabled ? "bg-primary" : "bg-slate-400"}`} />
          {enabled ? "已启用" : "已停用"}
        </p>
      </div>
      <Switch id="enabled" checked={enabled} onCheckedChange={updateEnabled}
        disabled={!initialized || disabled} aria-label="自动点击" />
    </header>

    <Card className="gap-3 p-3.5 shadow-xs">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">当前网站</p>
          <h2 className="mt-0.5 truncate font-bold" title={site?.hostname || undefined}>
            {site?.hostname || (initialized ? "当前页面不可用" : "正在读取…")}
          </h2>
        </div>
        <Button id="manage-rules" size="sm" variant="outline" className="border-input text-primary" disabled={disabled} onClick={() =>
          act("manage", setPageFeedback, "无法打开规则管理页面，请重试。", async () => {
            await openRules();
            window.close();
          })}>
          <LayoutList /> 管理规则
        </Button>
      </div>
      <Button id="pick-element" className="w-full" disabled={!initialized || !supported || disabled} onClick={() => startPicker()}>
        <Crosshair /> {authorized || !supported ? "在页面上选取元素" : "授权并选取元素"}
      </Button>
      <Feedback id="picker-status" value={pageFeedback || defaultFeedback} />
      {rules.length > 0 && <section aria-label="站点规则" className="grid gap-2 border-t pt-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{rules.length} 条规则</Badge>
          <Button size="sm" variant="outline" className="border-input text-primary" disabled={disabled}
            onClick={() => pause({ paused: !sitePaused })}>
            {sitePaused ? <Play /> : <Pause />}
            {sitePaused ? "恢复当前站点" : "暂停当前站点"}
          </Button>
          {!authorized && <Button id="authorize-site" size="sm" variant="outline" disabled={disabled} onClick={authorizeCurrentSite}>
            <ShieldCheck /> 授权当前站点
          </Button>}
        </div>
        <ul id="site-rule-list" className="popup-rule-list grid max-h-[12.5rem] grid-cols-1 gap-1 overflow-x-hidden overflow-y-auto pr-0.5">
          {rules.map((rule) => <RuleRow key={rule.id} rule={rule} expanded={openRuleId === rule.id}
            authorized={authorized} disabled={disabled}
            onExpand={(open) => setOpenRuleId((current) => open ? rule.id : current === rule.id ? null : current)}
            onTest={() => diagnose(rule)}
            onPause={() => pause({ selector: rule.selector, expectedId: rule.id, paused: !rule.paused })}
            onPick={() => startPicker(rule)}
            onRemove={() => remove(rule)} />)}
        </ul>
      </section>}
    </Card>

    <Card aria-label="点击设置" className="gap-3 p-3.5 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="cooldown" className="font-medium">同一元素冷却</label>
        <div className="flex w-32 items-center gap-2">
          <Input id="cooldown" type="number" min="1000" max="300000" step="1000"
            aria-describedby="cooldown-unit" value={cooldown} onChange={(event) => set({ cooldown: event.target.value })} />
          <span id="cooldown-unit" className="text-xs text-muted-foreground">ms</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button id="scan-now" variant="outline" className="border-input text-primary" disabled={!connected || disabled} onClick={scanNow}>
          <RotateCw /> 立即扫描
        </Button>
        <Button id="save" variant="secondary" className="border-input font-semibold" disabled={!initialized || disabled} onClick={() =>
          act("save", setSettingsFeedback, "保存设置失败，请重试。", async () => {
            await persist(enabled);
            setSettingsFeedback({ text: "设置已保存。" });
          })}><Save /> 保存设置</Button>
      </div>
      <Feedback value={settingsFeedback} />
    </Card>
    {(pageClicks != null || totalClicks != null) && <footer className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
      {pageClicks != null && <span>本页已点击 {pageClicks.toLocaleString("zh-CN")} 次</span>}
      {totalClicks != null && <span>本机累计 {totalClicks.toLocaleString("zh-CN")} 次</span>}
    </footer>}
  </main>;
}

createRoot(document.getElementById("root")).render(<Popup />);
