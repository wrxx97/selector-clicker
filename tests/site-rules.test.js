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
        getURL: (file) => `chrome-extension://test/${file}`,
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

test("re-picking is scoped to the sender site and refuses to replace a recreated rule", async () => {
  const worker = createWorker();
  const sender = { url: "https://example.com/" };
  const detailsKey = "siteRuleDetails:example.com";
  await worker.send({ type: "save-site-selector", selector: "#close", name: "Close" }, sender);
  const { id } = worker.store.get(detailsKey)["selector:#close"];
  const request = { type: "replace-picked-selector", selector: "#close", replacement: "#new", expectedId: id };
  assert.deepEqual(await worker.send(request, { url: "https://other.example/" }), { ok: false, reason: "missing" });
  assert.deepEqual(await worker.send(request, sender), { ok: true, selectors: ["#new"] });
  assert.deepEqual(structuredClone(worker.store.get(detailsKey)["selector:#new"]), { id, name: "Close" });
  await worker.send({ type: "save-site-selector", selector: "#close" }, sender);
  assert.deepEqual(await worker.send(request, sender), { ok: false, reason: "missing" });
});

test("preserves a paused rule through an edit and isolates the site pause", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const selector = "#close";
  const sender = { url: `https://${hostname}/` };
  await worker.send({ type: "save-site-selector", selector, name: "Close" }, sender);
  const detailsKey = "siteRuleDetails:example.com";
  const { id } = worker.store.get(detailsKey)["selector:#close"];
  await worker.send({ type: "set-rule-paused", hostname, selector, expectedId: id, paused: true });
  await worker.send({ type: "set-site-paused", hostname, paused: true });
  await worker.send({ type: "edit-site-selector", hostname, selector, replacement: "#other" });
  assert.deepEqual(structuredClone(worker.store.get(detailsKey)["selector:#other"]), { id, name: "Close", paused: true });
  assert.equal(worker.store.get("sitePaused:example.com"), true);
  assert.equal(worker.store.has("sitePaused:other.example"), false);
  await worker.send({ type: "set-site-paused", hostname, paused: false });
  assert.equal(worker.store.has("sitePaused:example.com"), false);
  assert.equal(worker.store.get(detailsKey)["selector:#other"].paused, true);
});

test("validates execution options and retains them when a target is re-picked", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const sender = { url: `https://${hostname}/` };
  await worker.send({ type: "save-site-selector", selector: "#close", name: "Close" }, sender);
  const detailsKey = "siteRuleDetails:example.com";
  const { id } = worker.store.get(detailsKey)["selector:#close"];
  const edit = { type: "edit-site-selector", hostname, selector: "#close", replacement: "#close" };
  assert.deepEqual(await worker.send({ ...edit, pathPrefix: "https://example.com/", maxClicks: 1 }), { ok: false });
  assert.deepEqual(await worker.send({ ...edit, pathPrefix: "/", maxClicks: 1.2 }), { ok: false });
  assert.equal((await worker.send({ ...edit, pathPrefix: "/dashboard/", maxClicks: 1 })).ok, true);
  const request = { type: "replace-picked-selector", selector: "#close", replacement: "#new", expectedId: id };
  assert.equal((await worker.send(request, sender)).ok, true);
  assert.deepEqual(structuredClone(worker.store.get(detailsKey)["selector:#new"]), {
    id, name: "Close", pathPrefix: "/dashboard", maxClicks: 1
  });
});

test("imports a backup atomically, skips duplicates, and preserves existing rule identities", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const sender = { url: "chrome-extension://test/rules.html" };
  await worker.send({ type: "save-site-selector", selector: "#first", name: "Keep" }, { url: `https://${hostname}/` });
  const detailsKey = "siteRuleDetails:example.com";
  const first = structuredClone(worker.store.get(detailsKey)["selector:#first"]);
  const second = { selector: "#second", name: "Second", paused: true, pathPrefix: "/tasks", maxClicks: 1 };
  const backup = { format: "selector-clicker-rules", version: 1, sites: [
    { hostname, paused: true, rules: [{ selector: "#first", name: "Changed" }, second, second] }
  ] };
  assert.deepEqual(await worker.send({ type: "import-rules", backup }, sender), {
    ok: true, addedCount: 1, duplicateCount: 2
  });
  assert.deepEqual(structuredClone(worker.store.get(detailsKey)["selector:#first"]), first);
  assert.equal(worker.store.has("sitePaused:example.com"), false);
  const { id, ...actual } = worker.store.get(detailsKey)["selector:#second"];
  const { selector, ...expected } = second;
  assert.ok(id && id !== first.id);
  assert.deepEqual(actual, expected);
  const add = { hostname: "other.example", rules: [{ selector: "#okay" }] };
  const invalid = { hostname: "invalid.example", rules: [{ selector: "#bad", maxClicks: -1 }] };
  const broken = { ...backup, sites: [add, invalid] };
  assert.deepEqual(await worker.send({ type: "import-rules", backup: broken }, sender), { ok: false });
  assert.equal(worker.store.has("siteSelectors:other.example"), false);
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
