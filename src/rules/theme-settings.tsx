import { memo } from "react";
import { Check } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Card } from "@/components/ui/card";
import type { ToastFeedback } from "@/components/ui/toast";
import { useTranslation } from "react-i18next";
import { saveTheme, themeOptions, useThemeStore, type ThemeId } from "@/lib/theme";

export const ThemeSettings = memo(function ThemeSettings(
  { setFeedback }: { setFeedback(feedback: ToastFeedback): void }
) {
  const { t } = useTranslation();
  const { theme, ready } = useThemeStore(useShallow((state) => ({ theme: state.theme, ready: state.ready })));

  async function choose(next: ThemeId) {
    try {
      await saveTheme(next);
    } catch {
      setFeedback({ text: t("themeSaveError"), error: true });
    }
  }

  return <Card className="gap-2 px-4 py-3 shadow-xs">
    <fieldset disabled={!ready} className="min-w-0">
      <legend className="mb-2 font-semibold">{t("theme")}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {themeOptions.map(({ id, name, swatch }) => <label key={id} className="min-w-0 cursor-pointer">
          <input type="radio" name="ui-theme" value={id} checked={theme === id} className="peer sr-only"
            onChange={() => choose(id)} />
          <span className="flex min-h-10 items-center gap-2 rounded-lg border border-input px-2.5 py-1.5 transition-colors
            hover:bg-accent peer-checked:border-primary peer-checked:bg-secondary peer-focus-visible:ring-2
            peer-focus-visible:ring-ring peer-disabled:opacity-60">
            <span aria-hidden="true" className="size-5 shrink-0 rounded-full ring-1 ring-foreground/15"
              style={{ background: swatch }} />
            <span className="font-medium">{t(name)}</span>
            {theme === id && <Check size={15} aria-hidden="true" className="ml-auto shrink-0 text-primary" />}
          </span>
        </label>)}
      </div>
    </fieldset>
  </Card>;
});
