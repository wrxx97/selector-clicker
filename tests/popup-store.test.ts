import assert from "node:assert/strict";
import { compileRuntimeScript } from "../src/build/runtime-scripts";
import { test } from "node:test";
import { runInThisContext } from "node:vm";
import type { PageRequest, StoredValues, WorkerRequest } from "../src/lib/extension-types";

test("popup keeps rule and settings references stable on click updates and refreshes only affected rules", async () => {
  runInThisContext(compileRuntimeScript("site-rules.js"));
  const hostname = "example.com";
  const selectorsKey = `siteSelectors:${hostname}`;
  const detailsKey = `siteRuleDetails:${hostname}`;
  const selectors = ["#first", "#second"];
  const details: Record<string, { id: string; name: string; paused?: boolean }> = {
    "selector:#first": { id: "first", name: "First" },
    "selector:#second": { id: "second", name: "Second" }
  };
  const saved: StoredValues = { enabled: true, cooldown: 5000, [selectorsKey]: selectors, [detailsKey]: details };
  let ruleReads = 0;
  let pageClicks = 2;
  let failPause = false;
  let scanCount = 0;
  let failScan = false;
  const writes: StoredValues[] = [];
  const chromeMock = {
    storage: {
      sync: {
        async get(defaults: StoredValues) {
          if (selectorsKey in defaults) ruleReads += 1;
          return structuredClone(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, saved[key] ?? value])));
        },
        async set(values: StoredValues) {
          writes.push(values);
          Object.assign(saved, values);
        }
      },
      local: { async get(defaults: StoredValues) {
        return { ...defaults, authorizedSitePatterns: ["https://example.com/*"] };
      } }
    },
    tabs: {
      async query() { return [{ id: 1, url: "https://example.com/page" }]; },
      async sendMessage(_id: number, { type }: PageRequest) {
        if (type === "scan-now") {
          if (failScan) throw new Error("Tab disconnected");
          scanCount += 1;
          return { totalClicks: pageClicks };
        }
        return { authorized: true, enabled: saved.enabled, totalClicks: pageClicks };
      }
    },
    permissions: { async contains() { return true; } },
    runtime: {
      async sendMessage(message: Extract<WorkerRequest, { type: "set-site-paused" | "set-rule-paused" }>) {
        if (failPause) return { ok: false };
        const targets = message.type === "set-site-paused" ? selectors : [message.selector];
        for (const target of targets) details[`selector:${target}`].paused = message.paused;
        return { ok: true };
      }
    }
  };
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: chromeMock });

  try {
    const { usePopupStore } = await import("../src/popup/store.ts");
    const initial = usePopupStore.getState();
    await initial.initialize();
    const baseline = usePopupStore.getState();
    assert.equal(baseline.connected, true);
    assert.equal(ruleReads, 1);

    baseline.storageChanged({ "siteSelectors:other.example": { newValue: ["#third"] } }, "sync");
    assert.equal(ruleReads, 1);
    pageClicks = 3;
    baseline.storageChanged({ totalClickCount: { newValue: 3 } }, "local");
    await new Promise((resolve) => setImmediate(resolve));
    const afterClick = usePopupStore.getState();
    assert.equal(afterClick.totalClicks, 3);
    assert.equal(afterClick.pageClicks, 3);
    assert.equal(afterClick.rules, baseline.rules);
    assert.equal(afterClick.site, baseline.site);
    assert.equal(afterClick.enabled, baseline.enabled);

    await baseline.loadRules();
    assert.equal(usePopupStore.getState().rules, baseline.rules);
    details["selector:#first"].name = "Changed";
    await baseline.loadRules();
    const updated = usePopupStore.getState().rules;
    assert.notEqual(updated[0], baseline.rules[0]);
    assert.equal(updated[0].name, "Changed");
    assert.equal(updated[1], baseline.rules[1]);

    const state = usePopupStore.getState;
    await state().pause({ paused: true });
    assert.deepEqual(state().rules.map((rule) => rule.paused), [true, true]);
    assert.equal(state().toast?.text, "已暂停全部规则。");
    await state().scan();
    assert.equal(scanCount, 0);
    assert.equal(state().toast?.text, "当前站点的规则均已暂停。");

    await state().pause({ paused: false });
    assert.deepEqual(state().rules.map((rule) => rule.paused), [false, false]);
    assert.equal(state().toast?.text, "已恢复全部规则。");
    await state().pause({ paused: true });

    await state().pause({ selector: "#first", expectedId: "first", paused: false });
    assert.deepEqual(state().rules.map((rule) => rule.paused), [false, true]);
    assert.equal(state().toast, null);

    await state().pause({ paused: true });
    details["selector:#second"].paused = false;
    state().storageChanged({ [detailsKey]: { newValue: saved[detailsKey] } }, "sync");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(state().rules.map((rule) => rule.paused), [true, false]);

    failPause = true;
    await state().pause({ selector: "#first", expectedId: "first", paused: false });
    const previousToast = state().toast;
    assert.ok(previousToast);
    assert.equal(previousToast.error, true);
    const { readCooldown, saveCooldown } = await import("../src/lib/extension.ts");
    assert.equal(await readCooldown(), 5000);
    await saveCooldown(9000);
    assert.deepEqual(writes, [{ cooldown: 9000 }]);
    const beforeSettingsChange = state();
    state().storageChanged({ cooldown: { newValue: 9000 } }, "sync");
    assert.equal(state(), beforeSettingsChange);
    pageClicks = 4;
    await state().scan();
    assert.equal(scanCount, 1);
    assert.equal(state().pageClicks, 4);
    assert.equal(state().toast?.text, "已扫描当前页面。");
    failScan = true;
    await state().scan();
    assert.deepEqual(state().toast, { text: "无法扫描此页面。", error: true });
    assert.deepEqual(writes, [{ cooldown: 9000 }]);
    await state().setEnabled(false);
    assert.deepEqual(writes, [{ cooldown: 9000 }, { enabled: false }]);
    assert.equal(await readCooldown(), 9000);
    await state().scan();
    assert.equal(scanCount, 1);
    assert.equal(state().toast?.text, "开启自动点击后即可扫描。");
    state().dismissToast(previousToast);
    const latestToast = state().toast;
    assert.ok(latestToast);
    state().dismissToast(latestToast);
    assert.equal(state().toast, null);
  } finally {
    Reflect.deleteProperty(globalThis, "chrome");
  }
});
