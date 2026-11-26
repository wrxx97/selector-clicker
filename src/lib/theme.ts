import { create } from "zustand";
import { listenToStorage } from "./extension";

export const themeOptions = [
  { id: "sky", name: "themeSky", swatch: "linear-gradient(135deg, #c2e5ff, #397bcb)" },
  { id: "lavender", name: "themeLavender", swatch: "linear-gradient(135deg, #e9d6ff, #8352cb)" },
  { id: "rose", name: "themeRose", swatch: "linear-gradient(135deg, #ffd9bd, #c3448b)" },
  { id: "amber", name: "themeAmber", swatch: "linear-gradient(135deg, #ffe1a1, #c16c25)" },
  { id: "night", name: "themeNight", swatch: "linear-gradient(135deg, #506392, #101828)" }
] as const;

export type ThemeId = typeof themeOptions[number]["id"];
const DEFAULT_THEME: ThemeId = "sky";
const settingKey = "uiTheme";

export const useThemeStore = create<{ theme: ThemeId; ready: boolean }>(() => ({
  theme: DEFAULT_THEME,
  ready: false
}));

let storageRevision = 0;
let writes = Promise.resolve();

function applyTheme(value: unknown) {
  const theme = themeOptions.find((option) => option.id === value)?.id ?? DEFAULT_THEME;
  document.documentElement.dataset.uiTheme = theme;
  useThemeStore.setState((state) => state.ready && state.theme === theme ? state : { theme, ready: true });
}

export function startTheme() {
  let active = true;
  const revision = storageRevision;
  const unsubscribe = listenToStorage((changes, area) => {
    if (area !== "sync" || !changes[settingKey]) return;
    storageRevision += 1;
    applyTheme(changes[settingKey].newValue);
  });

  void chrome.storage.sync.get({ [settingKey]: DEFAULT_THEME }).then((stored) => {
    if (active && storageRevision === revision) applyTheme(stored[settingKey]);
  }, () => {
    if (active && storageRevision === revision) applyTheme(DEFAULT_THEME);
  });

  return () => { active = false; unsubscribe(); };
}

export function saveTheme(theme: ThemeId) {
  const update = writes.then(async () => {
    if (useThemeStore.getState().theme === theme) return;
    const revision = storageRevision;
    await chrome.storage.sync.set({ [settingKey]: theme });
    if (storageRevision === revision) applyTheme(theme);
  });
  writes = update.catch(() => {});
  return update;
}
