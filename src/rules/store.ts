import { create } from "zustand";
import { shallow } from "zustand/shallow";
import { getRuleSites, isRuleChange, isStatsKey, listenToStorage, readRules, readStats } from "@/lib/extension";
import type { RuleSite, StoredValues } from "@/lib/extension-types";

interface RulesState {
  sites: RuleSite[] | null;
  stats: StoredValues | null;
  search: string;
  loadError: boolean;
  setSearch(search: string): void;
  loadRules(): Promise<void>;
}

function reuseSites(previous: RuleSite[] | null, incoming: RuleSite[]): RuleSite[] {
  if (!previous) return incoming;
  const byHost = new Map(previous.map((site) => [site.hostname, site]));
  const sites = incoming.map((site) => {
    const old = byHost.get(site.hostname);
    if (!old) return site;
    const byId = new Map(old.rules.map((rule) => [rule.id, rule]));
    const rules = site.rules.map((rule) => {
      const prior = byId.get(rule.id);
      return prior && shallow(prior, rule) ? prior : rule;
    });
    return shallow(old.rules, rules) && old.paused === site.paused ? old : { ...site, rules };
  });
  return shallow(previous, sites) ? previous : sites;
}

export const useRulesStore = create<RulesState>((set) => {
  let request = 0;
  return {
    sites: null,
    stats: null,
    search: "",
    loadError: false,
    setSearch: (search) => set({ search }),
    async loadRules() {
      const current = ++request;
      try {
        const stored = await readRules();
        if (current === request) set((state) => {
          const sites = reuseSites(state.sites, getRuleSites(stored));
          return sites === state.sites && !state.loadError ? state : { sites, loadError: false };
        });
      } catch {
        if (current === request) set({ loadError: true });
      }
    }
  };
});

export function startRules() {
  let active = true;
  const { loadRules } = useRulesStore.getState();
  const unsubscribe = listenToStorage((changes, area) => {
    if (area === "sync" && isRuleChange(changes)) void loadRules();
    if (area !== "local") return;
    const stats = Object.entries(changes).filter(([key]) => isStatsKey(key));
    if (stats.length) {
      useRulesStore.setState((state) => ({
        stats: { ...state.stats, ...Object.fromEntries(stats.map(([key, change]) => [key, change.newValue])) }
      }));
    }
  });
  void loadRules();
  void readStats().then((stored) => {
    if (active) useRulesStore.setState((state) => ({
      stats: { ...Object.fromEntries(Object.entries(stored).filter(([key]) => isStatsKey(key))), ...state.stats }
    }));
  }).catch(() => {});
  return () => { active = false; unsubscribe(); };
}
