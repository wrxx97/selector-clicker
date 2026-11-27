import { create } from "zustand";
import { shallow } from "zustand/shallow";
import { getManagedRuleSites, isHideRuleChange, isRuleChange, isStatsKey, listenToStorage, readRules, readStats, sameHideTarget } from "@/lib/extension";
import type { HideRule, ManagedRuleSite, Rule, StoredValues } from "@/lib/extension-types";

interface RulesState {
  sites: ManagedRuleSite[] | null;
  stats: StoredValues | null;
  search: string;
  loadError: boolean;
  setSearch(search: string): void;
  loadRules(): Promise<void>;
}

function reuseRules<T extends Rule | HideRule>(old: T[], current: T[], same: (first: T, second: T) => boolean) {
  const byId = new Map(old.map((rule) => [rule.id, rule]));
  const rules = current.map((rule) => {
    const prior = byId.get(rule.id);
    return prior && same(prior, rule) ? prior : rule;
  });
  return shallow(old, rules) ? old : rules;
}

function reuseSites(previous: ManagedRuleSite[] | null, incoming: ManagedRuleSite[]): ManagedRuleSite[] {
  if (!previous) return incoming;
  const byHost = new Map(previous.map((site) => [site.hostname, site]));
  const sites = incoming.map((site) => {
    const old = byHost.get(site.hostname);
    if (!old) return site;
    const rules = reuseRules(old.rules, site.rules, shallow);
    const hideRules = reuseRules(old.hideRules, site.hideRules, (first, second) =>
      first.name === second.name && first.paused === second.paused && sameHideTarget(first, second));
    return rules === old.rules && hideRules === old.hideRules && old.paused === site.paused
      ? old : { ...site, rules, hideRules };
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
          const sites = reuseSites(state.sites, getManagedRuleSites(stored));
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
    if (area === "sync" && (isRuleChange(changes) || isHideRuleChange(changes))) void loadRules();
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
