import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ToastFeedback } from "@/components/ui/toast";
import { BROWSER_CLICK_ENABLED_KEY, listenToStorage, supportsBrowserClick } from "@/lib/extension";

export const ExperimentalSettings = memo(function ExperimentalSettings(
  { setFeedback }: { setFeedback(feedback: ToastFeedback): void }
) {
  const { t } = useTranslation();
  const [available] = useState(supportsBrowserClick);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!available) return;
    let active = true;
    let changed = false;
    const unsubscribe = listenToStorage((changes, area) => {
      if (area !== "local" || !changes[BROWSER_CLICK_ENABLED_KEY]) return;
      changed = true;
      setEnabled(changes[BROWSER_CLICK_ENABLED_KEY].newValue === true);
    });
    void chrome.storage.local.get({ [BROWSER_CLICK_ENABLED_KEY]: false }).then((stored) => {
      if (active && !changed) setEnabled(stored[BROWSER_CLICK_ENABLED_KEY] === true);
    }, () => {
      if (active && !changed) setFeedback({ text: t("experimentalSettingsReadError"), error: true });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [available, setFeedback, t]);

  async function change(next: boolean) {
    setSaving(true);
    try {
      await chrome.storage.local.set({ [BROWSER_CLICK_ENABLED_KEY]: next });
    } catch {
      setFeedback({ text: t("experimentalSettingsSaveError"), error: true });
    } finally {
      setSaving(false);
    }
  }

  if (!available) return null;
  return <Card aria-labelledby="experimental-title" className="gap-2 px-4 py-3 shadow-xs">
    <h2 id="experimental-title" className="font-semibold">{t("experimentalTitle")}</h2>
    <div className="flex items-center justify-between gap-3">
      <div className="grid gap-0.5">
        <label htmlFor="experimental-browser-click" className="text-sm font-medium">{t("experimentalBrowserClick")}</label>
        <p id="experimental-click-description" className="text-xs text-muted-foreground">
          {t("experimentalBrowserClickDescription")}
        </p>
      </div>
      <Switch id="experimental-browser-click" aria-describedby="experimental-click-description"
        checked={enabled === true} disabled={enabled === null || saving} onCheckedChange={change} />
    </div>
  </Card>;
});
