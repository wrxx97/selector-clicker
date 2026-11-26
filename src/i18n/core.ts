import { createInstance, type ThirdPartyModule } from "i18next";
import english from "./locales/en/translation.json";
import simplifiedChinese from "./locales/zh-CN/translation.json";

const resources = {
  en: { translation: english },
  "zh-CN": { translation: simplifiedChinese }
};

export type ExtensionLocale = keyof typeof resources;
export type LanguagePreference = ExtensionLocale | "auto";
export type TranslationKey = keyof typeof english;

export const languageStorageKey = "uiLanguage";

export function normalizePreference(value: unknown): LanguagePreference {
  return value === "en" || value === "zh-CN" ? value : "auto";
}

export function resolveLocale(
  preference: LanguagePreference,
  browserLanguage = globalThis.chrome?.i18n?.getUILanguage?.() ?? "en"
): ExtensionLocale {
  if (preference !== "auto") return preference;
  return /^zh(?:[-_](?:cn|sg|hans)(?:[-_]|$)|$)/i.test(browserLanguage) ? "zh-CN" : "en";
}

export function createI18n(locale: ExtensionLocale, plugin?: ThirdPartyModule) {
  const instance = createInstance();
  if (plugin) instance.use(plugin);
  void instance.init({
    lng: locale,
    supportedLngs: Object.keys(resources),
    fallbackLng: "en",
    resources,
    initAsync: false,
    interpolation: { escapeValue: false }
  });
  return instance;
}
