import { initReactI18next } from "react-i18next";
import { create } from "zustand";
import { listenToStorage } from "./extension";
import {
  createI18n, languageStorageKey, normalizePreference, resolveLocale,
  type ExtensionLocale, type LanguagePreference, type TranslationKey
} from "../i18n/core";

const browserLocale = resolveLocale("auto");
const i18n = createI18n(browserLocale, initReactI18next);

export const useLanguageStore = create<{
  preference: LanguagePreference;
  locale: ExtensionLocale;
  ready: boolean;
}>(() => ({ preference: "auto", locale: browserLocale, ready: false }));

export const translate = i18n.t;

let storageRevision = 0;
let writes = Promise.resolve();

function applyLanguage(value: unknown) {
  const preference = normalizePreference(value);
  const locale = resolveLocale(preference);
  if (i18n.language !== locale) void i18n.changeLanguage(locale);
  useLanguageStore.setState((state) => state.ready && state.preference === preference && state.locale === locale
    ? state : { preference, locale, ready: true });
}

export function startLanguage(title: TranslationKey) {
  const updateDocument = ({ locale }: ReturnType<typeof useLanguageStore.getState>) => {
    document.documentElement.lang = locale;
    document.title = i18n.getFixedT(locale)(title);
  };
  updateDocument(useLanguageStore.getState());
  const stopTitle = useLanguageStore.subscribe(updateDocument);

  let active = true;
  const revision = storageRevision;
  const unsubscribe = listenToStorage((changes, area) => {
    if (area !== "sync" || !changes[languageStorageKey]) return;
    storageRevision += 1;
    applyLanguage(changes[languageStorageKey].newValue);
  });
  void chrome.storage.sync.get({ [languageStorageKey]: "auto" }).then((stored) => {
    if (active && storageRevision === revision) applyLanguage(stored[languageStorageKey]);
  }, () => {
    if (active && storageRevision === revision) applyLanguage("auto");
  });
  return () => { active = false; stopTitle(); unsubscribe(); };
}

export function saveLanguage(preference: LanguagePreference) {
  const update = writes.then(async () => {
    if (useLanguageStore.getState().preference === preference) return;
    const revision = storageRevision;
    await chrome.storage.sync.set({ [languageStorageKey]: preference });
    if (storageRevision === revision) applyLanguage(preference);
  });
  writes = update.catch(() => {});
  return update;
}
