import { create } from "zustand";
import {
  connectToPage, hasSiteAccess, readActiveSite, readSettings, readSiteRules, settingsDefaults,
  TOTAL_CLICK_COUNT_KEY
} from "./extension.js";

let rulesRequest = 0;

export const usePopupStore = create((set, get) => ({
  site: null,
  enabled: settingsDefaults.enabled,
  cooldown: String(settingsDefaults.cooldown),
  rules: [],
  sitePaused: false,
  authorized: false,
  connected: false,
  pageClicks: null,
  totalClicks: null,
  initialized: false,
  set,
  async load() {
    try {
      const [settings, site] = await Promise.all([readSettings(), readActiveSite()]);
      set({ site, enabled: settings.enabled, cooldown: String(settings.cooldown) });
      await Promise.all([get().loadRules(), get().loadPage()]);
    } finally {
      set({ initialized: true });
    }
  },
  async loadRules() {
    const request = ++rulesRequest;
    const data = await readSiteRules(get().site?.hostname);
    if (request === rulesRequest) set(data);
  },
  async loadPage() {
    const { site } = get();
    const authorized = await hasSiteAccess(site?.pattern);
    set({ authorized });
    if (!authorized) {
      set({ connected: false, pageClicks: null });
      return;
    }
    try {
      const response = await connectToPage(site);
      set({ connected: true, pageClicks: response.totalClicks });
    } catch {
      set({ connected: false, pageClicks: null });
    }
  },
  async loadTotal() {
    const saved = await chrome.storage.local.get({ [TOTAL_CLICK_COUNT_KEY]: 0 });
    set({ totalClicks: saved[TOTAL_CLICK_COUNT_KEY] });
  }
}));
