import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Card } from "@/components/ui/card";
import type { ToastFeedback } from "@/components/ui/toast";
import type { LanguagePreference } from "@/i18n/core";
import { saveLanguage, translate, useLanguageStore } from "@/lib/i18n";

const languages = [
  { value: "auto", label: "followBrowser", lang: undefined },
  { value: "zh-CN", label: "simplifiedChinese", lang: "zh-CN" },
  { value: "en", label: "english", lang: "en" }
] as const;

export const LanguageSettings = memo(function LanguageSettings(
  { setFeedback }: { setFeedback(feedback: ToastFeedback): void }
) {
  const { t } = useTranslation();
  const { preference, ready } = useLanguageStore(useShallow(({ preference, ready }) => ({ preference, ready })));

  async function choose(value: LanguagePreference) {
    try {
      await saveLanguage(value);
    } catch {
      setFeedback({ text: translate("languageSaveError"), error: true });
    }
  }

  return <Card className="gap-2 px-4 py-3 shadow-xs">
    <fieldset disabled={!ready} className="min-w-0">
      <legend className="mb-2 font-semibold">{t("language")}</legend>
      <div className="flex flex-wrap gap-2">
        {languages.map(({ value, label, lang }) => <label key={value} className="cursor-pointer">
          <input type="radio" name="ui-language" value={value} checked={preference === value}
            className="peer sr-only" onChange={() => choose(value)} />
          <span className="flex min-h-10 items-center gap-2 rounded-lg border border-input px-3 py-1.5
            hover:bg-accent peer-checked:border-primary peer-checked:bg-secondary peer-focus-visible:ring-2
            peer-focus-visible:ring-ring peer-disabled:opacity-60">
            <span lang={lang}>{t(label)}</span>
            {preference === value && <Check size={15} aria-hidden="true" className="text-primary" />}
          </span>
        </label>)}
      </div>
    </fieldset>
  </Card>;
});
