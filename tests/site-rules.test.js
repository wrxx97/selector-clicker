const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createWorker() {
  const store = new Map();
  let onMessage;
  let context;
  function loadScript(file) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  context = vm.createContext({
    URL,
    importScripts: loadScript,
    chrome: {
      action: {},
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: { addListener(listener) { onMessage = listener; } }
      },
      tabs: { onUpdated: { addListener() {} } },
      storage: {
        sync: {
          async get(defaults) {
            return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, store.get(key) ?? value]));
          },
          async set(values) {
            for (const [key, value] of Object.entries(values)) store.set(key, value);
          },
          async remove(key) {
            store.delete(key);
          }
        }
      }
    }
  });
  loadScript("service-worker.js");
  return {
    store,
    send(message, sender = {}) {
      return new Promise((resolve) => {
        onMessage(message, sender, (response) => resolve(structuredClone(response)));
      });
    }
  };
}

test("concurrent saves keep both rules and deduplicate a selector on the same hostname", async () => {
  const worker = createWorker();
  const save = (selector, url) => worker.send({ type: "save-site-selector", selector }, { url });
  await Promise.all([
    save("#ad-close", "https://example.com/one"),
    save("#dialog-close", "https://example.com/two"),
    save("#ad-close", "https://example.com/three"),
    save("#ad-close", "https://sub.example.com/")
  ]);

  assert.deepEqual([...worker.store.get("siteSelectors:example.com")], ["#ad-close", "#dialog-close"]);
  assert.deepEqual([...worker.store.get("siteSelectors:sub.example.com")], ["#ad-close"]);
});

test("removing the last rule only removes that hostname's storage key", async () => {
  const worker = createWorker();
  const save = (url) => worker.send({ type: "save-site-selector", selector: "#close" }, { url });
  await save("https://example.com/");
  await save("https://other.example/");
  assert.deepEqual(await save("file:///example.html"), { ok: false });

  const response = await worker.send({
    type: "remove-site-selector",
    hostname: "example.com",
    selector: "#close"
  });
  assert.deepEqual(response, { ok: true, selectors: [] });
  assert.equal(worker.store.has("siteSelectors:example.com"), false);
  assert.equal(worker.store.has("siteSelectors:other.example"), true);
});
