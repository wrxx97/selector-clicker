import assert from "node:assert/strict";
import { test } from "node:test";

test("reads and synchronizes theme preferences and preserves the latest selection", async () => {
  let listener;
  let resolveInitial;
  const dataset = {};
  const writes = [];
  globalThis.document = { documentElement: { dataset } };
  globalThis.chrome = {
    storage: {
      sync: {
        get: () => new Promise((resolve) => { resolveInitial = resolve; }),
        async set(settings) {
          if (settings.uiTheme === "rose") throw new Error("Storage unavailable");
          writes.push(settings);
        }
      },
      onChanged: {
        addListener(callback) { listener = callback; },
        removeListener(callback) { assert.equal(listener, callback); listener = undefined; }
      }
    }
  };

  try {
    const { saveTheme, startTheme, themeOptions, useThemeStore } = await import("../src/lib/theme.ts");
    const stop = startTheme();
    try {
      assert.equal(themeOptions.length, 5);
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
    delete globalThis.chrome;
    delete globalThis.document;
  }
});
