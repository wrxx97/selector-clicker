import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ToastFeedback } from "@/components/ui/toast";
import { cooldownRange, listenToStorage, normalizeCooldown, readCooldown, saveCooldown } from "@/lib/extension";

const STEP_MS = 1000;
const INPUT_DELAY_MS = 250;

function parseCooldown(draft: string) {
  const value = Number(draft);
  return Number.isFinite(value) && value >= cooldownRange.min && value <= cooldownRange.max ? value : null;
}

interface CooldownSettingsProps {
  setFeedback(feedback: ToastFeedback): void;
  dismiss(feedback: ToastFeedback): void;
}

export function CooldownSettings({ setFeedback, dismiss }: CooldownSettingsProps) {
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const lastError = useRef<ToastFeedback | null>(null);
  const pending = useRef<{ timer: number; write: () => void } | null>(null);
  const writes = useRef(Promise.resolve());
  const revision = useRef(0);

  const reportError = useCallback((text: string) => {
    const feedback = { text, error: true };
    lastError.current = feedback;
    setFeedback(feedback);
  }, [setFeedback]);

  useEffect(() => {
    let active = true;
    let receivedChange = false;
    const unsubscribe = listenToStorage((changes, area) => {
      if (area !== "sync" || !changes.cooldown) return;
      receivedChange = true;
      setSaved(normalizeCooldown(changes.cooldown.newValue));
    });
    void readCooldown().then((value) => {
      if (active && !receivedChange) setSaved(value);
    }, () => {
      if (active && !receivedChange) reportError("无法读取冷却设置，请重新打开此页面。");
    });
    return () => {
      active = false;
      unsubscribe();
      if (pending.current) window.clearTimeout(pending.current.timer);
      pending.current = null;
    };
  }, [reportError]);

  function flushPending() {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    window.clearTimeout(next.timer);
    next.write();
  }

  function update(value: string, immediate = false) {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    setDraft(value);
    if (lastError.current) {
      dismiss(lastError.current);
      lastError.current = null;
    }
    const edit = ++revision.current;
    const cooldown = parseCooldown(value);
    const write = () => {
      if (cooldown === null) {
        reportError("请输入 1,000–300,000 毫秒。");
        return;
      }
      writes.current = writes.current.then(async () => {
        if (edit !== revision.current) return;
        await saveCooldown(cooldown);
        setSaved(cooldown);
        if (edit === revision.current) setDraft(null);
      }).catch(() => {
        if (edit === revision.current) reportError("无法更新冷却时间，请重新调整后重试。");
      });
    };
    if (immediate) write();
    else pending.current = { timer: window.setTimeout(flushPending, INPUT_DELAY_MS), write };
  }

  const parsed = draft === null ? saved : parseCooldown(draft);
  const current = parsed ?? saved;
  const invalid = draft !== null && parsed === null;

  function step(amount: number) {
    if (current === null) return;
    const next = normalizeCooldown(current + amount);
    if (next !== current) update(String(next), true);
  }

  return <Card aria-label="点击设置" className="gap-2 px-4 py-3 shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="grid gap-0.5">
        <label htmlFor="cooldown" className="font-semibold">同一元素冷却</label>
        <p id="cooldown-description" className="text-xs text-muted-foreground">同一元素两次自动点击的最短间隔，调整后自动生效。</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button type="button" variant="outline" size="icon" className="text-primary" aria-label="减少 1 秒" title="减少 1 秒"
          disabled={current === null || current <= cooldownRange.min} onClick={() => step(-STEP_MS)}><Minus /></Button>
        <Input id="cooldown" type="number" min={cooldownRange.min} max={cooldownRange.max} step="any"
          className="w-24 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-describedby="cooldown-unit cooldown-description" aria-invalid={invalid || undefined}
          value={draft ?? (saved === null ? "" : String(saved))} disabled={saved === null}
          onChange={(event) => update(event.target.value)} onBlur={flushPending} onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              step(event.key === "ArrowUp" ? STEP_MS : -STEP_MS);
            }
            if (event.key === "Enter") flushPending();
          }} />
        <Button type="button" variant="outline" size="icon" className="text-primary" aria-label="增加 1 秒" title="增加 1 秒"
          disabled={current === null || current >= cooldownRange.max} onClick={() => step(STEP_MS)}><Plus /></Button>
        <span id="cooldown-unit" className="text-xs text-muted-foreground">ms</span>
      </div>
    </div>
  </Card>;
}
