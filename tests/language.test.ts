import assert from "node:assert/strict";
import test from "node:test";
import { runInThisContext } from "node:vm";
import { compileRuntimeScript } from "../src/build/runtime-scripts";
import { createI18n, normalizePreference, resolveLocale } from "../src/i18n/core";
import type { StorageChanges, StoredValues } from "../src/lib/extension-types";

runInThisContext(compileRuntimeScript("site-rules.js"));

test("resolves the browser language, explicit overrides, and the default", () => {
  assert.equal(resolveLocale("auto", "zh-CN"), "zh-CN");
  assert.equal(resolveLocale("auto", "zh-Hans"), "zh-CN");
  assert.equal(resolveLocale("auto", "en-GB"), "en");
  assert.equal(resolveLocale("auto", "fr"), "en");
  assert.equal(resolveLocale(normalizePreference(null), "zh-CN"), "zh-CN");
  assert.equal(resolveLocale("en", "zh-CN"), "en");
  assert.equal(resolveLocale("zh-CN", "en-US"), "zh-CN");

  const english = createI18n("en");
  const chinese = createI18n("zh-CN");
  const selection = { matches: 1200, hostname: "example.com" };
  assert.equal(english.t("pickerMatch", selection), "Matches on this page: 1,200. This rule applies only to example.com.");
  assert.equal(chinese.t("pickerMatch", selection), "当前页面匹配 1,200 个元素。仅在 example.com 生效。");
  assert.equal(chinese.t("rules", { count: 1 }), "1 条规则");
  assert.equal(chinese.t("rules", { count: 2 }), "2 条规则");
  assert.equal(english.t("testRule", { label: '#sample[data-label="<Next>"]' }), 'Test rule #sample[data-label="<Next>"]');
});

test("updates the active pages using the stored language and preserves newer preferences", async () => {
  type StorageListener = (changes: StorageChanges, area: string) => void;
  let listener: StorageListener | undefined;
  let resolveInitial!: (value: StoredValues) => void;
  const page = { documentElement: { lang: "" }, title: "" };
  const writes: StoredValues[] = [];
  const chromeMock = {
    i18n: { getUILanguage: () => "zh-CN" },
    storage: {
      sync: {
        get: () => new Promise<StoredValues>((resolve) => { resolveInitial = resolve; }),
        async set(values: StoredValues) { writes.push(values); }
      },
      onChanged: {
        addListener(callback: StorageListener) { listener = callback; },
        removeListener(callback: StorageListener) { assert.equal(listener, callback); listener = undefined; }
      }
    }
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: chromeMock });
  try {
    const { saveLanguage, startLanguage, translate, useLanguageStore } = await import("../src/lib/i18n");
    const stop = startLanguage("rulesPageTitle");
    try {
      assert.equal(page.documentElement.lang, "zh-CN");
      assert.ok(listener);
      listener({ uiLanguage: { newValue: "en" } }, "sync");
      resolveInitial({ uiLanguage: "zh-CN" });
      await new Promise((resolve) => setImmediate(resolve));

      assert.equal(page.documentElement.lang, "en");
      assert.equal(page.title, "Rule Manager · Selector Clicker");
      assert.equal(translate("allPaused"), "Paused all rules.");
      assert.equal(translate("rules", { count: 1 }), "1 rule");
      assert.equal(translate("rules", { count: 2 }), "2 rules");

      await saveLanguage("zh-CN");
      assert.equal(page.documentElement.lang, "zh-CN");
      assert.equal(translate("allPaused"), "已暂停全部规则。");
      assert.deepEqual(writes, [{ uiLanguage: "zh-CN" }]);

      listener({ uiLanguage: {} }, "sync");
      assert.equal(useLanguageStore.getState().preference, "auto");
      assert.equal(page.documentElement.lang, "zh-CN");
    } finally {
      stop();
    }
  } finally {
    Reflect.deleteProperty(globalThis, "document");
    Reflect.deleteProperty(globalThis, "chrome");
  }
});
