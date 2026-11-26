import { create } from "zustand";
import { shallow } from "zustand/shallow";
import type { TranslationKey } from "@/i18n/core";
import { translate as t } from "@/lib/i18n";
import type { ToastFeedback } from "@/components/ui/toast";
import {
  AUTHORIZED_SITES_KEY, TOTAL_CLICK_COUNT_KEY, changePause, connectToPage, hasSiteAccess, isRuleChange,
  listenToStorage, openRules, readActiveSite, readEnabled, readSiteRules, requestSiteAccess, saveEnabled,
  send, sendToPage
} from "@/lib/extension";
import type { ActiveSite, PauseOptions, Rule, RuleTestStatus, StorageChanges } from "@/lib/extension-types";

type Operation = "site" | "settings";

interface PopupState {
  site: ActiveSite | null;
  initialized: boolean;
  enabled: boolean;
  rules: Rule[];
  authorized: boolean;
  connected: boolean;
  pageClicks: number | null;
  totalClicks: number | null;
  siteBusy: boolean;
  settingsBusy: boolean;
  toast: ToastFeedback | null;
  dismissToast(feedback: ToastFeedback): void;
  initialize(): Promise<void>;
  loadRules(): Promise<void>;
  storageChanged(changes: StorageChanges, area: string): void;
  setEnabled(enabled: boolean): Promise<void>;
  scan(): Promise<void>;
  manage(): Promise<void>;
  authorize(): Promise<void>;
  pick(rule?: Rule): Promise<void>;
  diagnose(rule: Rule): Promise<void>;
  pause(options: PauseOptions): Promise<void>;
  remove(rule: Rule): Promise<void>;
}

const diagnostics: Record<Exclude<RuleTestStatus, "ambiguous">, TranslationKey> = {
  ready: "diagnosticReady",
  missing: "diagnosticMissing",
  removed: "diagnosticRemoved",
  hidden: "diagnosticHidden",
  disabled: "diagnosticDisabled",
  cooldown: "diagnosticCooldown",
  "site-paused": "diagnosticSitePaused",
  "rule-paused": "diagnosticRulePaused",
  "out-of-scope": "diagnosticOutOfScope",
  "limit-reached": "diagnosticLimit",
  invalid: "diagnosticInvalid"
};

function keepUnchangedRules(previous: Rule[], incoming: Rule[]) {
  const existing = new Map(previous.map((rule) => [rule.id, rule]));
  const updated = incoming.map((rule) => {
    const old = existing.get(rule.id);
    return old && shallow(old, rule) ? old : rule;
  });
  return updated.length === previous.length && updated.every((rule, index) => rule === previous[index])
    ? previous : updated;
}

export const usePopupStore = create<PopupState>((set, get) => {
  let rulesRequest = 0;
  let pageRequest = 0;
  let clicksRequest = 0;

  function requireSite() {
    const { site } = get();
    if (!site) throw new Error("No active website");
    return site;
  }

  async function run(operation: Operation, error: string, task: () => Promise<string | void>) {
    const busyKey = operation === "site" ? "siteBusy" : "settingsBusy";
    if (get()[busyKey]) return;
    set({ [busyKey]: true, toast: null });
    try {
      const text = await task();
      if (text) set({ toast: { text } });
    } catch {
      set({ toast: { text: error, error: true } });
    } finally {
      set({ [busyKey]: false });
    }
  }

  async function loadPage() {
    const { site } = get();
    const request = ++pageRequest;
    const authorized = site ? await hasSiteAccess(site.pattern) : false;
    if (request !== pageRequest) return;
    if (!authorized || !site) {
      set({ authorized: false, connected: false, pageClicks: null });
      return;
    }
    set({ authorized: true });
    const status = await connectToPage(site).catch(() => null);
    if (request === pageRequest) {
      set({ connected: status !== null, pageClicks: status?.totalClicks ?? null });
    }
  }

  function reportSiteStatus() {
    const { site, authorized, connected } = get();
    if (!site) {
      set({ toast: { text: t("regularPage") } });
    } else if (!authorized) {
      set({ toast: { text: t("siteAccessNeeded") } });
    } else if (!connected) {
      set({ toast: { text: t("connectError"), error: true } });
    }
  }

  async function refreshClicks() {
    const { site, connected } = get();
    if (!site || !connected) return;
    const request = ++clicksRequest;
    const page = pageRequest;
    try {
      const status = await sendToPage(site, { type: "get-status" });
      if (status?.authorized && request === clicksRequest && page === pageRequest && get().connected) {
        set({ pageClicks: status.totalClicks });
      }
    } catch {
      // The next popup opening will reconnect to a navigated tab.
    }
  }

  return {
    site: null,
    initialized: false,
    enabled: false,
    rules: [],
    authorized: false,
    connected: false,
    pageClicks: null,
    totalClicks: null,
    siteBusy: false,
    settingsBusy: false,
    toast: null,
    dismissToast: (feedback) => set((state) => state.toast === feedback ? { toast: null } : state),
    async initialize() {
      void chrome.storage.local.get({ [TOTAL_CLICK_COUNT_KEY]: 0 }).then((stored) => {
        set({ totalClicks: Number(stored[TOTAL_CLICK_COUNT_KEY]) || 0 });
      }).catch(() => {});
      try {
        const [enabled, site] = await Promise.all([readEnabled(), readActiveSite()]);
        set({ site, enabled });
        if (site) await Promise.all([get().loadRules(), loadPage()]);
        if (!get().siteBusy && !get().toast) reportSiteStatus();
      } catch {
        set({ toast: { text: t("popupReadError"), error: true } });
      } finally {
        set({ initialized: true });
      }
    },
    async loadRules() {
      const { site } = get();
      if (!site) return;
      const request = ++rulesRequest;
      const incoming = await readSiteRules(site.hostname);
      if (request === rulesRequest) set((state) => {
        const rules = keepUnchangedRules(state.rules, incoming);
        return rules === state.rules ? state : { rules };
      });
    },
    storageChanged(changes, area) {
      if (area === "sync") {
        const { site } = get();
        if (site && isRuleChange(changes, site.hostname)) void get().loadRules().catch(() => {});
        if (changes.enabled) set({ enabled: changes.enabled.newValue === true });
      }
      if (area === "local") {
        if (changes[TOTAL_CLICK_COUNT_KEY]) {
          set({ totalClicks: Number(changes[TOTAL_CLICK_COUNT_KEY].newValue) || 0 });
          void refreshClicks();
        }
        if (changes[AUTHORIZED_SITES_KEY]) {
          const { authorized, connected } = get();
          void loadPage().then(() => {
            const state = get();
            if (state.initialized && !state.siteBusy &&
                (state.authorized !== authorized || state.connected !== connected)) reportSiteStatus();
          }).catch(() => {});
        }
      }
    },
    setEnabled: (enabled) => run("settings", t("settingsSaveError"), async () => {
      await saveEnabled(enabled);
      set({ enabled });
    }),
    scan: () => run("site", t("scanError"), async () => {
      const { enabled, rules } = get();
      if (!enabled) return t("enableBeforeScan");
      if (!rules.length) return t("noCurrentRules");
      if (rules.every((rule) => rule.paused)) return t("allCurrentRulesPaused");
      const result = await sendToPage(requireSite(), { type: "scan-now" });
      if (!result) throw new Error("No scan response");
      set({ pageClicks: result.totalClicks });
      return t("pageScanned");
    }),
    manage: () => run("site", t("managerOpenError"), async () => {
      await openRules();
      window.close();
    }),
    authorize: () => run("site", t("authorizeError"), async () => {
      if (!await requestSiteAccess(requireSite().pattern)) return t("accessDenied");
      await loadPage();
      return get().connected ? t("accessGranted") : t("accessGrantedRefresh");
    }),
    pick: (rule) => run("site", t("pickerOpenError"), async () => {
      const site = requireSite();
      if (!get().authorized && !await requestSiteAccess(site.pattern)) return t("accessDenied");
      const status = await connectToPage(site);
      set({ authorized: true, connected: true, pageClicks: status.totalClicks });
      const editing = rule ? { selector: rule.selector, expectedId: rule.id } : {};
      const result = await sendToPage(site, { type: "start-picker", ...editing });
      if (!result?.ok) throw new Error("Could not start picker");
      window.close();
    }),
    diagnose: (rule) => run("site", t("testError"), async () => {
      const site = requireSite();
      await connectToPage(site);
      const result = await sendToPage(site, { type: "test-rule", selector: rule.selector });
      if (!result) throw new Error("No diagnostic response");
      return result.status === "ambiguous"
        ? t("diagnosticAmbiguous", { matches: result.count ?? 0 }) : t(diagnostics[result.status]);
    }),
    pause: (options) => {
      const bulk = options.selector === undefined;
      return run("site", t("pauseError"), async () => {
        await changePause(requireSite().hostname, options);
        await get().loadRules();
        if (bulk) return options.paused ? t("allPaused") : t("allResumed");
      });
    },
    remove: (rule) => run("site", t("popupRemoveError"), async () => {
      const result = await send({ type: "remove-site-selector", hostname: requireSite().hostname, selector: rule.selector });
      if (!result?.ok) throw new Error("Could not remove rule");
      await get().loadRules();
    })
  };
});

export function startPopup() {
  const { initialize, storageChanged } = usePopupStore.getState();
  const unsubscribe = listenToStorage(storageChanged);
  void initialize();
  return unsubscribe;
}
