import { create } from "zustand";
import { getRuleSites, readRules, readStats } from "./extension";

let rulesRequest = 0;
let statsRequest = 0;

export const useRulesStore = create((set) => ({
  sites: null,
  stats: null,
  search: "",
  loadError: false,
  setSearch: (search) => set({ search }),
  async loadRules() {
    const request = ++rulesRequest;
    try {
      const stored = await readRules();
      if (request === rulesRequest) set({ sites: getRuleSites(stored), loadError: false });
    } catch {
      if (request === rulesRequest) set({ loadError: true });
    }
  },
  async loadStats() {
    const request = ++statsRequest;
    const stats = await readStats().catch(() => null);
    if (request === statsRequest) set({ stats });
  }
}));
