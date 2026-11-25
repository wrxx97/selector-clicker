import { create } from "zustand";
import { shallow } from "zustand/shallow";
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

const diagnostics: Record<Exclude<RuleTestStatus, "ambiguous">, string> = {
  ready: "匹配到一个可点击元素，已在页面高亮。",
  missing: "当前页面没有匹配元素。",
  removed: "这条规则已移除或修改，请重新打开弹窗。",
  hidden: "匹配的元素不可见。",
  disabled: "匹配的元素不可点击。",
  cooldown: "匹配的元素仍在点击冷却中。",
  "site-paused": "当前站点已暂停。",
  "rule-paused": "这条规则已暂停。",
  "out-of-scope": "当前页面路径不在规则的生效范围内。",
  "limit-reached": "这条规则已达到本页点击上限。",
  invalid: "CSS 选择器格式无效。"
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
      set({ toast: { text: "请在普通网页上选取元素。" } });
    } else if (!authorized) {
      set({ toast: { text: "授权后可在当前站点选取元素和运行规则。" } });
    } else if (!connected) {
      set({ toast: { text: "无法连接当前网页，请刷新后重试。", error: true } });
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
        set({ toast: { text: "无法读取扩展状态，请重新打开弹窗。", error: true } });
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
    setEnabled: (enabled) => run("settings", "保存设置失败，请重试。", async () => {
      await saveEnabled(enabled);
      set({ enabled });
    }),
    scan: () => run("site", "无法扫描此页面。", async () => {
      const { enabled, rules } = get();
      if (!enabled) return "开启自动点击后即可扫描。";
      if (!rules.length) return "当前站点还没有规则。";
      if (rules.every((rule) => rule.paused)) return "当前站点的规则均已暂停。";
      const result = await sendToPage(requireSite(), { type: "scan-now" });
      if (!result) throw new Error("No scan response");
      set({ pageClicks: result.totalClicks });
      return "已扫描当前页面。";
    }),
    manage: () => run("site", "无法打开规则管理页面，请重试。", async () => {
      await openRules();
      window.close();
    }),
    authorize: () => run("site", "授权当前站点失败，请重试。", async () => {
      if (!await requestSiteAccess(requireSite().pattern)) return "未授予当前站点访问权限。";
      await loadPage();
      return get().connected ? "已授权当前站点。" : "已授权，请刷新当前网页后重试。";
    }),
    pick: (rule) => run("site", "无法进入选取模式，请刷新网页后重试。", async () => {
      const site = requireSite();
      if (!get().authorized && !await requestSiteAccess(site.pattern)) return "未授予当前站点访问权限。";
      const status = await connectToPage(site);
      set({ authorized: true, connected: true, pageClicks: status.totalClicks });
      const editing = rule ? { selector: rule.selector, expectedId: rule.id } : {};
      const result = await sendToPage(site, { type: "start-picker", ...editing });
      if (!result?.ok) throw new Error("Could not start picker");
      window.close();
    }),
    diagnose: (rule) => run("site", "无法测试此页面，请刷新后重试。", async () => {
      const site = requireSite();
      await connectToPage(site);
      const result = await sendToPage(site, { type: "test-rule", selector: rule.selector });
      if (!result) throw new Error("No diagnostic response");
      return result.status === "ambiguous"
        ? `匹配到 ${result.count} 个元素，请重新选取。` : diagnostics[result.status];
    }),
    pause: (options) => {
      const bulk = options.selector === undefined;
      return run("site", "无法修改暂停状态，请重试。", async () => {
        await changePause(requireSite().hostname, options);
        await get().loadRules();
        if (bulk) return options.paused ? "已暂停全部规则。" : "已恢复全部规则。";
      });
    },
    remove: (rule) => run("site", "移除失败，请重试。", async () => {
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
