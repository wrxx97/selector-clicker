import assert from "node:assert/strict";
import { compileRuntimeScript } from "../src/build/runtime-scripts";
import { test } from "node:test";
import { runInThisContext } from "node:vm";
import type { StorageChanges, StoredValues } from "../src/lib/extension-types";

test("rules store preserves unaffected groups and rows and consumes click updates without rereading storage", async () => {
  runInThisContext(compileRuntimeScript("site-rules.js"));
  type StorageListener = (changes: StorageChanges, area: string) => void;
  let storageListener: StorageListener | undefined;
  let reads = 0;
  let statsReads = 0;
  let finishStats!: (value: StoredValues) => void;
  const saved = {
    "siteSelectors:first.example": ["#one", "#two"],
    "siteSelectors:second.example": ["#three"],
    "siteRuleDetails:first.example": { "selector:#one": { id: "one", name: "Original" } }
  };
  const chromeMock = {
    storage: {
      sync: { async get() { reads += 1; return structuredClone(saved); } },
      local: { get() { statsReads += 1; return new Promise<StoredValues>((resolve) => { finishStats = resolve; }); } },
      onChanged: {
        addListener(listener: StorageListener) { storageListener = listener; },
        removeListener() { storageListener = undefined; }
      }
    }
  };
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: chromeMock });
  try {
    const { useRulesStore, startRules } = await import("../src/rules/store.ts");
    const stop = startRules();
    try {
      const state = useRulesStore.getState;
      const tick = () => new Promise((resolve) => setImmediate(resolve));
      await tick();
      const groups = state().sites;
      assert.ok(groups);
      assert.ok(storageListener);
      storageListener({ totalClickCount: { newValue: 5 } }, "local");
      finishStats({ totalClickCount: 4 });
      await tick();
      assert.equal(state().stats?.totalClickCount, 5);
      assert.equal(state().sites, groups);
      assert.equal(statsReads, 1);
      assert.equal(reads, 1);

      saved["siteRuleDetails:first.example"]["selector:#one"].name = "Edited";
      storageListener({ "siteRuleDetails:first.example": { newValue: saved["siteRuleDetails:first.example"] } }, "sync");
      await tick();
      const updated = state().sites;
      assert.ok(updated);
      assert.notEqual(updated[0], groups[0]);
      assert.equal(updated[0].rules[0].name, "Edited");
      assert.equal(updated[0].rules[1], groups[0].rules[1]);
      assert.equal(updated[1], groups[1]);
      await state().loadRules();
      assert.equal(state().sites, updated);
    } finally {
      stop();
    }
  } finally {
    Reflect.deleteProperty(globalThis, "chrome");
  }
});
