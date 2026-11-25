const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createWorker() {
  const store = new Map();
  const local = new Map();
  let onMessage;
  let context;
  function loadScript(file) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  function storageArea(values) {
    return {
      async get(defaults) {
        return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, values.get(key) ?? value]));
      },
      async set(entries) {
        for (const [key, value] of Object.entries(entries)) values.set(key, value);
      },
      async remove(keys) {
        for (const key of [].concat(keys)) values.delete(key);
      }
    };
  }
  context = vm.createContext({
    URL,
    crypto,
    importScripts: loadScript,
    chrome: {
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
      runtime: {
        onInstalled: { addListener() {} },
        onMessage: { addListener(listener) { onMessage = listener; } }
      },
      tabs: { onUpdated: { addListener() {} } },
      storage: {
        sync: storageArea(store),
        local: storageArea(local)
      }
    }
  });
  loadScript("service-worker.js");
  return {
    store,
    local,
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
  assert.equal(worker.store.has("siteRuleDetails:example.com"), false);
  assert.equal(worker.store.has("siteSelectors:other.example"), true);
});

test("editing a selector keeps its position and changes only the selected site", async () => {
  const worker = createWorker();
  const save = (selector, hostname) => worker.send({
    type: "save-site-selector",
    selector
  }, { url: `https://${hostname}/` });
  await save("#close", "example.com");
  await save("#dismiss", "example.com");
  await save("#close", "other.example");

  const [edit] = await Promise.all([
    worker.send({
      type: "edit-site-selector",
      hostname: "example.com",
      selector: "#close",
      replacement: "#new-close"
    }),
    save("#third", "example.com")
  ]);

  assert.deepEqual(edit, { ok: true, selectors: ["#new-close", "#dismiss"] });
  assert.deepEqual([...worker.store.get("siteSelectors:example.com")], ["#new-close", "#dismiss", "#third"]);
  assert.deepEqual([...worker.store.get("siteSelectors:other.example")], ["#close"]);
});

test("an edit does not overwrite a duplicate or recreate a rule removed elsewhere", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const key = "siteSelectors:example.com";
  worker.store.set(key, ["#close", "#dismiss"]);
  const edit = (selector, replacement) => worker.send({
    type: "edit-site-selector",
    hostname,
    selector,
    replacement
  });

  assert.deepEqual(await edit("#close", "#dismiss"), { ok: false, reason: "duplicate" });
  assert.deepEqual(await edit("#missing", "#new-close"), { ok: false, reason: "missing" });
  assert.deepEqual(await edit("#close", "  "), { ok: false });
  assert.deepEqual(worker.store.get(key), ["#close", "#dismiss"]);
});

test("saving an optional name keeps the existing selector array and stable rule identity", async () => {
  const worker = createWorker();
  const sender = { url: "https://example.com/" };
  const save = (name) => worker.send({ type: "save-site-selector", selector: "#close", name }, sender);
  const metaKey = "siteRuleDetails:example.com";

  await save("  关闭弹窗  ");
  const id = worker.store.get(metaKey)["selector:#close"].id;
  await save("");
  assert.deepEqual([...worker.store.get("siteSelectors:example.com")], ["#close"]);
  assert.equal(worker.store.get(metaKey)["selector:#close"].name, "关闭弹窗");
  await save("关闭通知");
  assert.deepEqual(structuredClone(worker.store.get(metaKey)["selector:#close"]), { id, name: "关闭通知" });
});

test("clicks accumulate locally across tabs and remain associated after a legacy rule is edited", async () => {
  const worker = createWorker();
  const ruleId = "selector:#close";
  worker.store.set("siteSelectors:example.com", ["#close"]);
  const record = (hostname, tabId, ruleIds) => worker.send({
    type: "click-record",
    totalClicks: ruleIds.length,
    ruleIds
  }, { url: `https://${hostname}/`, tab: { id: tabId } });

  await Promise.all([
    record("example.com", 1, [ruleId, "selector:#other"]),
    record("example.com", 2, [ruleId]),
    record("other.example", 3, [ruleId])
  ]);
  assert.equal(worker.local.get("totalClickCount"), 4);
  assert.equal(worker.local.get("siteClickCounts:example.com")[`rule:${ruleId}`], 2);
  assert.equal(worker.local.get("siteClickCounts:example.com")["rule:selector:#other"], 1);
  assert.equal(worker.local.get("siteClickCounts:other.example")[`rule:${ruleId}`], 1);
  assert.equal(worker.store.has("totalClickCount"), false);

  await worker.send({
    type: "edit-site-selector",
    hostname: "example.com",
    selector: "#close",
    replacement: "#new-close",
    name: "关闭广告"
  });
  const rule = worker.store.get("siteRuleDetails:example.com")["selector:#new-close"];
  assert.deepEqual(structuredClone(rule), { id: ruleId, name: "关闭广告" });
  await record("example.com", 2, [rule.id]);
  assert.equal(worker.local.get("totalClickCount"), 5);
  assert.equal(worker.local.get("siteClickCounts:example.com")[`rule:${ruleId}`], 3);
});
