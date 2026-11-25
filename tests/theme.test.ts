import assert from "node:assert/strict";
import { test } from "node:test";
import type { StorageChanges, StoredValues } from "../src/lib/extension-types";

test("reads and synchronizes theme preferences and preserves the latest selection", async () => {
  type StorageListener = (changes: StorageChanges, area: string) => void;
  let listener: StorageListener | undefined;
  let resolveInitial!: (value: StoredValues) => void;
  const dataset: Record<string, string> = {};
  const writes: StoredValues[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { dataset } } });
  const chromeMock = {
    storage: {
      sync: {
        get: () => new Promise<StoredValues>((resolve) => { resolveInitial = resolve; }),
        async set(settings: StoredValues) {
          if (settings.uiTheme === "rose") throw new Error("Storage unavailable");
          writes.push(settings);
        }
      },
      onChanged: {
        addListener(callback: StorageListener) { listener = callback; },
        removeListener(callback: StorageListener) { assert.equal(listener, callback); listener = undefined; }
      }
    }
  };
  Object.defineProperty(globalThis, "chrome", { configurable: true, value: chromeMock });

  try {
    const { saveTheme, startTheme, themeOptions, useThemeStore } = await import("../src/lib/theme.ts");
    const stop = startTheme();
    try {
      assert.equal(themeOptions.length, 5);
      assert.ok(listener);
      listener({ uiTheme: { newValue: "night" } }, "sync");
      resolveInitial({ uiTheme: "sky" });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(dataset.uiTheme, "night");
      assert.equal(useThemeStore.getState().theme, "night");

      await assert.rejects(saveTheme("rose"), /Storage unavailable/);
      assert.equal(dataset.uiTheme, "night");
      await Promise.all([saveTheme("lavender"), saveTheme("amber")]);
      assert.deepEqual(writes, [{ uiTheme: "lavender" }, { uiTheme: "amber" }]);
      assert.equal(dataset.uiTheme, "amber");
      listener({ uiTheme: { newValue: "unknown" } }, "sync");
      assert.equal(dataset.uiTheme, "sky");
      assert.equal(useThemeStore.getState().ready, true);
    } finally {
      stop();
    }
  } finally {
    Reflect.deleteProperty(globalThis, "chrome");
    Reflect.deleteProperty(globalThis, "document");
  }
});
