import { Crosshair, EyeOff, Pause, Play, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePopupStore } from "./store";

export function HideRules() {
  const { t } = useTranslation();
  const { site, initialized, busy, rules, pick, pause, remove } = usePopupStore(useShallow((state) => ({
    site: state.site, initialized: state.initialized, busy: state.siteBusy, rules: state.hideRules,
    pick: state.pick, pause: state.pauseHideRule, remove: state.removeHideRule
  })));
  const disabled = !initialized || !site || busy;

  return <>
    <div className="grid grid-cols-2 gap-1.5">
      <Button id="pick-hide-element" size="sm" disabled={disabled} onClick={() => pick(undefined, "hide-element")}>
        <Crosshair /> {t("hideSelectedElement")}
      </Button>
      <Button id="pick-hide-containing" size="sm" variant="outline" className="border-input text-primary"
        disabled={disabled} onClick={() => pick(undefined, "hide-containing")}>
        <EyeOff /> {t("hideContainingParent")}
      </Button>
    </div>
    <p className="text-xs leading-relaxed text-muted-foreground">{t("hideContainingHelp")}</p>
    {site && <section aria-label={t("autoHide")} className="grid gap-2 border-t pt-2.5">
      <div><Badge variant="secondary">{t("rules", { count: rules.length })}</Badge></div>
      {rules.length > 0 && <ul id="site-hide-rule-list" className="popup-rule-list grid max-h-[12.5rem] gap-1 overflow-y-auto pr-0.5">
        {rules.map((rule) => {
          const label = rule.name || rule.selector;
          const condition = rule.contains && (rule.contains.text || rule.contains.selector);
          return <li key={rule.id} data-paused={rule.paused}
            className="popup-rule flex min-w-0 items-center gap-1 rounded-lg border bg-muted/60 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              {rule.name && <strong className="block truncate text-xs" title={rule.name}>{rule.name}</strong>}
              <code className="block truncate text-xs text-muted-foreground" title={rule.selector}>{rule.selector}</code>
              {condition && <p className="truncate text-xs text-muted-foreground" title={condition}>
                {t("hideWhenContains", { condition })}
              </p>}
            </div>
            <Button size="icon-xs" variant="outline" disabled={busy}
              aria-label={t(rule.paused ? "resumeRule" : "pauseRule", { label })}
              title={t(rule.paused ? "resume" : "pause")} onClick={() => pause(rule)}>
              {rule.paused ? <Play /> : <Pause />}
            </Button>
            <Button size="icon-xs" variant="outline" disabled={busy}
              aria-label={t("removeRule", { label })} title={t("remove")} onClick={() => remove(rule)}>
              <Trash2 />
            </Button>
          </li>;
        })}
      </ul>}
    </section>}
  </>;
}
