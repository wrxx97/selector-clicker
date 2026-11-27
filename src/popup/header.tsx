import { useShallow } from "zustand/react/shallow";
import { BrandIcon } from "@/components/ui/brand-icon";
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "react-i18next";
import { usePopupStore } from "./store";

export function PopupHeader({ hiding }: { hiding: boolean }) {
  const { t } = useTranslation();
  const { enabled, initialized, settingsBusy, setEnabled } = usePopupStore(useShallow((state) => ({
    enabled: hiding ? state.hideEnabled : state.enabled, initialized: state.initialized,
    settingsBusy: state.settingsBusy, setEnabled: hiding ? state.setHideEnabled : state.setEnabled
  })));

  const status = initialized ? t(enabled ? "enabled" : "disabled") : t("loading");

  return <header className="flex items-center gap-3 rounded-2xl border border-border bg-linear-to-br from-banner-start to-banner-end px-3.5 py-3">
    <BrandIcon size={40} />
    <div className="min-w-0 flex-1">
      <h1 className="text-base font-bold tracking-tight">{t("appName")}</h1>
      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`size-1.5 rounded-full ${enabled ? "bg-primary" : "bg-slate-400"}`} />
        {hiding ? `${t("autoHide")} · ${status}` : status}
      </p>
    </div>
    <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled}
      disabled={!initialized || settingsBusy} aria-label={t(hiding ? "autoHide" : "autoClick")} />
  </header>;
}
