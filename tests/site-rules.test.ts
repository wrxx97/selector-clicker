import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import type { Rule, RuleBackup, StorageChanges, StoredValues, WorkerResponse } from "../src/lib/extension-types";

type WorkerMessage = { type: string; [key: string]: unknown };
type WorkerSender = { url?: string; tab?: { id: number } };
type WorkerListener = (message: WorkerMessage, sender: WorkerSender, reply: (value: WorkerResponse) => void) => void;
type StorageListener = (changes: StorageChanges, area: string) => Promise<void> | undefined;
type PermissionListener = (permissions: { origins?: string[] }) => Promise<unknown>;
type SavedRuleDetails = Record<string, Pick<Rule, "id"> & Partial<Omit<Rule, "id" | "selector">>>;

class FixtureStorage extends Map<string, unknown> {
  read<Value>(key: string): Value {
    assert.ok(this.has(key), `Missing storage value for ${key}`);
    return this.get(key) as Value;
  }
}

function createWorker(now = Date.now) {
  const store = new FixtureStorage();
  const local = new FixtureStorage();
  const grantedOrigins = new Set<string>();
  let registered: chrome.scripting.RegisteredContentScript | undefined;
  let permissionsAdded!: PermissionListener;
  let permissionsRemoved!: () => Promise<unknown>;
  let onMessage!: WorkerListener;
  let storageChanged!: StorageListener;
  let lastIcon: Record<number, string> | undefined;
  let context: vm.Context;
  function loadScript(file: string) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  function storageArea(values: FixtureStorage) {
    return {
      async get(defaults: StoredValues) {
        return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, values.get(key) ?? value]));
      },
      async set(entries: StoredValues) {
        for (const [key, value] of Object.entries(entries)) values.set(key, value);
      },
      async remove(keys: string | string[]) {
        for (const key of typeof keys === "string" ? [keys] : keys) values.delete(key);
      }
    };
  }
  context = vm.createContext({
    URL,
    Date: { now },
    crypto,
    importScripts: loadScript,
    chrome: {
      action: {
        setBadgeText() {}, setBadgeBackgroundColor() {},
        async setIcon({ path }: { path: Record<number, string> }) { lastIcon = structuredClone(path); }
      },
      runtime: {
        getURL: (file: string) => `chrome-extension://test/${file}`,
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener(listener: WorkerListener) { onMessage = listener; } }
      },
      tabs: { onUpdated: { addListener() {} } },
      permissions: {
        async contains({ origins }: { origins: string[] }) { return origins.every((origin) => grantedOrigins.has(origin)); },
        onAdded: { addListener(listener: PermissionListener) { permissionsAdded = listener; } },
        onRemoved: { addListener(listener: () => Promise<unknown>) { permissionsRemoved = listener; } }
      },
      scripting: {
        async getRegisteredContentScripts() { return registered ? [registered] : []; },
        async registerContentScripts([script]: chrome.scripting.RegisteredContentScript[]) { registered = script; },
        async updateContentScripts([script]: chrome.scripting.RegisteredContentScript[]) { registered = { ...registered, ...script }; },
        async unregisterContentScripts() { registered = undefined; }
      },
      storage: {
        sync: storageArea(store),
        local: storageArea(local),
        onChanged: { addListener(listener: StorageListener) { storageChanged = listener; } }
      }
    }
  });
  loadScript("service-worker.js");
  return {
    store,
    local,
    grantedOrigins,
    get registered() { return registered; },
    get lastIcon() { return lastIcon; },
    changeTheme(theme: string) {
      store.set("uiTheme", theme);
      return storageChanged({ uiTheme: { newValue: theme } }, "sync");
    },
    onPermissionsAdded: (origins: string[]) => permissionsAdded({ origins }),
    onPermissionsRemoved: () => permissionsRemoved(),
    backup() {
      const create = vm.runInContext("(stored) => createRuleBackup(getRuleSites(stored))", context) as (stored: StoredValues) => RuleBackup;
      return structuredClone(create(Object.fromEntries([...store, ...local])));
    },
    send(message: WorkerMessage, sender: WorkerSender = {}) {
      return new Promise<WorkerResponse>((resolve) => {
        onMessage(message, sender, (response) => resolve(structuredClone(response)));
      });
    }
  };
}

test("updates the static toolbar icon to the synced theme and falls back to blue", async () => {
  const worker = createWorker();
  await worker.changeTheme("rose");
  assert.deepEqual(worker.lastIcon, {
    16: "icons/icon-rose-16.png", 24: "icons/icon-rose-24.png", 32: "icons/icon-rose-32.png"
  });
  await worker.changeTheme("unknown");
  assert.deepEqual(worker.lastIcon, {
    16: "icons/icon-16.png", 24: "icons/icon-24.png", 32: "icons/icon-32.png"
  });
});

test("edits a site without overwriting its destination and keeps its rule data and click history", async () => {
  const worker = createWorker();
  const hostname = "source.example";
  const destination = "target.example";
  const sender = { url: "chrome-extension://test/rules.html" };
  const details = { "selector:#close": { id: "close", name: "Close", pathPrefix: "/tasks", maxClicks: 2 } };
  worker.store.set("siteSelectors:source.example", ["#close"]);
  worker.store.set("siteRuleDetails:source.example", details);
  worker.store.set("sitePaused:source.example", true);
  worker.store.set("siteSelectors:taken.example", ["#other"]);
  worker.local.set("siteClickCounts:target.example", { "rule:close": 50 });
  await worker.send({ type: "click-record", ruleIds: ["close"] }, { url: "https://source.example/", tab: { id: 1 } });
  const lastClick = worker.local.read<Record<string, number>>("siteLastClickTimes:source.example")["rule:close"];
  const move = { type: "rename-site", hostname, destination, expectedRuleIds: ["close"] };

  assert.deepEqual(await worker.send(move, { url: "https://source.example/" }), { ok: false });
  assert.deepEqual(await worker.send({ ...move, destination: "taken.example" }, sender), { ok: false, reason: "duplicate" });
  assert.deepEqual(await worker.send({ ...move, destination: "target.example:443" }, sender), { ok: false, reason: "invalid" });
  assert.deepEqual(await worker.send({ ...move, expectedRuleIds: ["outdated"] }, sender), { ok: false, reason: "changed" });
  assert.deepEqual(await worker.send({ ...move, destination: "TARGET.example" }, sender), { ok: true });
  assert.deepEqual(worker.backup().sites.map(({ hostname: site }) => site), ["taken.example", destination]);
  assert.deepEqual(structuredClone(worker.store.get("siteRuleDetails:target.example")), details);
  assert.equal(worker.store.get("sitePaused:target.example"), true);
  assert.equal(worker.local.read<Record<string, number>>("siteClickCounts:target.example")["rule:close"], 1);
  assert.equal(worker.local.read<Record<string, number>>("siteLastClickTimes:target.example")["rule:close"], lastClick);
  assert.equal(worker.local.get("totalClickCount"), 1);
});

test("deletes only the confirmed site's rules and refuses a stale confirmation", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const sender = { url: "chrome-extension://test/rules.html" };
  worker.store.set("siteSelectors:example.com", ["#one", "#two"]);
  worker.store.set("siteRuleDetails:example.com", { "selector:#one": { id: "first" } });
  worker.store.set("sitePaused:example.com", true);
  worker.store.set("siteSelectors:other.example", ["#one"]);
  worker.local.set("totalClickCount", 10);
  const request = { type: "remove-site-rules", hostname, expectedRuleIds: ["first", "selector:#two"] };

  assert.deepEqual(await worker.send({ ...request, expectedRuleIds: ["first"] }, sender), { ok: false, reason: "changed" });
  assert.deepEqual(await worker.send(request, sender), { ok: true });
  assert.equal(worker.store.has("siteSelectors:example.com"), false);
  assert.equal(worker.store.has("siteRuleDetails:example.com"), false);
  assert.equal(worker.store.has("sitePaused:example.com"), false);
  assert.deepEqual(worker.store.get("siteSelectors:other.example"), ["#one"]);
  assert.equal(worker.local.get("totalClickCount"), 10);
});

test("concurrent saves keep both rules and deduplicate a selector on the same hostname", async () => {
  const worker = createWorker();
  const save = (selector: string, url: string) => worker.send({ type: "save-site-selector", selector }, { url });
  await Promise.all([
    save("#ad-close", "https://example.com/one"),
    save("#dialog-close", "https://example.com/two"),
    save("#ad-close", "https://example.com/three"),
    save("#ad-close", "https://sub.example.com/")
  ]);

  assert.deepEqual([...worker.store.read<string[]>("siteSelectors:example.com")], ["#ad-close", "#dialog-close"]);
  assert.deepEqual([...worker.store.read<string[]>("siteSelectors:sub.example.com")], ["#ad-close"]);
});

test("removing the last rule only removes that hostname's storage key", async () => {
  const worker = createWorker();
  const save = (url: string) => worker.send({ type: "save-site-selector", selector: "#close" }, { url });
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
  const save = (selector: string, hostname: string) => worker.send({
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
  assert.deepEqual([...worker.store.read<string[]>("siteSelectors:example.com")], ["#new-close", "#dismiss", "#third"]);
  assert.deepEqual([...worker.store.read<string[]>("siteSelectors:other.example")], ["#close"]);
});

test("an edit does not overwrite a duplicate or recreate a rule removed elsewhere", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const key = "siteSelectors:example.com";
  worker.store.set(key, ["#close", "#dismiss"]);
  const edit = (selector: string, replacement: string) => worker.send({
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
  const save = (name: string) => worker.send({ type: "save-site-selector", selector: "#close", name }, sender);
  const metaKey = "siteRuleDetails:example.com";

  await save("  关闭弹窗  ");
  const id = worker.store.read<SavedRuleDetails>(metaKey)["selector:#close"].id;
  await save("");
  assert.deepEqual([...worker.store.read<string[]>("siteSelectors:example.com")], ["#close"]);
  assert.equal(worker.store.read<SavedRuleDetails>(metaKey)["selector:#close"].name, "关闭弹窗");
  await save("关闭通知");
  assert.deepEqual(structuredClone(worker.store.read<SavedRuleDetails>(metaKey)["selector:#close"]), { id, name: "关闭通知" });
});

test("re-picking is scoped to the sender site and refuses to replace a recreated rule", async () => {
  const worker = createWorker();
  const sender = { url: "https://example.com/" };
  const detailsKey = "siteRuleDetails:example.com";
  await worker.send({ type: "save-site-selector", selector: "#close", name: "Close" }, sender);
  const { id } = worker.store.read<SavedRuleDetails>(detailsKey)["selector:#close"];
  const request = { type: "replace-picked-selector", selector: "#close", replacement: "#new", expectedId: id };
  assert.deepEqual(await worker.send(request, { url: "https://other.example/" }), { ok: false, reason: "missing" });
  assert.deepEqual(await worker.send(request, sender), { ok: true, selectors: ["#new"] });
  assert.deepEqual(structuredClone(worker.store.read<SavedRuleDetails>(detailsKey)["selector:#new"]), { id, name: "Close" });
  await worker.send({ type: "save-site-selector", selector: "#close" }, sender);
  assert.deepEqual(await worker.send(request, sender), { ok: false, reason: "missing" });
});

test("batch pause updates each rule and allows individual and batch resume", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const sender = { url: `https://${hostname}/` };
  const detailsKey = "siteRuleDetails:example.com";
  const save = (selector: string, name: string, source = sender) => worker.send({ type: "save-site-selector", selector, name }, source);
  const pauseAll = (paused: boolean) => worker.send({ type: "set-site-paused", hostname, paused });
  const rules = () => {
    const site = worker.backup().sites.find((site) => site.hostname === hostname);
    assert.ok(site);
    return site.rules;
  };
  const states = () => rules().map((rule) => rule.paused);

  await save("#close", "Close");
  await save("#dismiss", "Dismiss");
  await save("#close", "Other", { url: "https://other.example/" });
  const { id } = worker.store.read<SavedRuleDetails>(detailsKey)["selector:#close"];
  const pauseRule = (paused: boolean) => worker.send({
    type: "set-rule-paused", hostname, selector: "#close", expectedId: id, paused
  });

  await pauseRule(true);
  assert.deepEqual(states(), [true, false]);
  await pauseAll(true);
  assert.deepEqual(states(), [true, true]);
  assert.equal(worker.backup().sites[0].paused, true);
  assert.equal(worker.store.has("sitePaused:example.com"), false);
  assert.equal(worker.backup().sites[1].rules[0].paused, false);
  await Promise.all([pauseAll(true), pauseRule(false)]);
  assert.deepEqual(states(), [false, true]);
  assert.equal(worker.backup().sites[0].paused, false);
  await pauseAll(true);
  await worker.send({ type: "edit-site-selector", hostname, selector: "#close", replacement: "#other" });
  assert.deepEqual(structuredClone(worker.store.read<SavedRuleDetails>(detailsKey)["selector:#other"]), { id, name: "Close", paused: true });
  await save("#new", "New");
  assert.deepEqual(states(), [true, true, false]);
  await pauseAll(false);
  assert.deepEqual(states(), [false, false, false]);
});

test("converts a legacy site pause without losing IDs, execution conditions, or other rules' pause state", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const detailsKey = "siteRuleDetails:example.com";
  worker.store.set("siteSelectors:example.com", ["#old", "#other"]);
  worker.store.set("sitePaused:example.com", true);
  worker.store.set(detailsKey, { "selector:#other": { id: "other", name: "Other", maxClicks: 3 } });
  assert.deepEqual(worker.backup().sites[0].rules.map((rule) => rule.paused), [true, true]);

  const result = await worker.send({
    type: "set-rule-paused", hostname, selector: "#old", expectedId: "selector:#old", paused: false
  });

  assert.equal(result.ok, true);
  assert.equal(worker.store.get("sitePaused:example.com"), false);
  assert.deepEqual(worker.backup().sites[0].rules.map((rule) => rule.paused), [false, true]);
  assert.deepEqual(structuredClone(worker.store.read<SavedRuleDetails>(detailsKey)["selector:#other"]), {
    id: "other", name: "Other", maxClicks: 3, paused: true
  });
});

test("validates execution options and retains them when a target is re-picked", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const sender = { url: `https://${hostname}/` };
  await worker.send({ type: "save-site-selector", selector: "#close", name: "Close" }, sender);
  const detailsKey = "siteRuleDetails:example.com";
  const { id } = worker.store.read<SavedRuleDetails>(detailsKey)["selector:#close"];
  const edit = { type: "edit-site-selector", hostname, selector: "#close", replacement: "#close" };
  assert.deepEqual(await worker.send({ ...edit, pathPrefix: "https://example.com/", maxClicks: 1 }), { ok: false });
  assert.deepEqual(await worker.send({ ...edit, pathPrefix: "/", maxClicks: 1.2 }), { ok: false });
  assert.equal((await worker.send({ ...edit, pathPrefix: "/dashboard/", maxClicks: 1 })).ok, true);
  const request = { type: "replace-picked-selector", selector: "#close", replacement: "#new", expectedId: id };
  assert.equal((await worker.send(request, sender)).ok, true);
  assert.deepEqual(structuredClone(worker.store.read<SavedRuleDetails>(detailsKey)["selector:#new"]), {
    id, name: "Close", pathPrefix: "/dashboard", maxClicks: 1
  });
});

test("imports a backup atomically, skips duplicates, and preserves existing rule identities", async () => {
  const worker = createWorker();
  const hostname = "example.com";
  const sender = { url: "chrome-extension://test/rules.html" };
  await worker.send({ type: "save-site-selector", selector: "#first", name: "Keep" }, { url: `https://${hostname}/` });
  const detailsKey = "siteRuleDetails:example.com";
  const first = structuredClone(worker.store.read<SavedRuleDetails>(detailsKey)["selector:#first"]);
  const second = { selector: "#second", name: "Second", paused: false, pathPrefix: "/tasks", maxClicks: 1 };
  const backup = { format: "selector-clicker-rules", version: 1, sites: [
    { hostname, paused: true, rules: [{ selector: "#first", name: "Changed" }, second, second] }
  ] };
  assert.deepEqual(await worker.send({ type: "import-rules", backup }, sender), {
    ok: true, addedCount: 1, duplicateCount: 2
  });
  assert.deepEqual(structuredClone(worker.store.read<SavedRuleDetails>(detailsKey)["selector:#first"]), first);
  assert.equal(worker.store.has("sitePaused:example.com"), false);
  const { id, ...actual } = worker.store.read<SavedRuleDetails>(detailsKey)["selector:#second"];
  const { selector, ...expected } = second;
  assert.ok(id && id !== first.id);
  assert.deepEqual(actual, { ...expected, paused: true });
  const add = { hostname: "other.example", rules: [{ selector: "#okay" }] };
  const invalid = { hostname: "invalid.example", rules: [{ selector: "#bad", maxClicks: -1 }] };
  const broken = { ...backup, sites: [add, invalid] };
  assert.deepEqual(await worker.send({ type: "import-rules", backup: broken }, sender), { ok: false });
  assert.equal(worker.store.has("siteSelectors:other.example"), false);
});

test("registers content scripts only for exact granted origins and removes them on revocation", async () => {
  const worker = createWorker();
  const sender = { url: "chrome-extension://test/popup.html" };
  const site = "https://example.com/*";
  const broad = "https://*/*";
  const authorize = (pattern: string) => worker.send({ type: "authorize-site", pattern }, sender);
  assert.deepEqual(await authorize(site), { ok: false });
  worker.grantedOrigins.add(broad);
  await worker.onPermissionsAdded([broad]);
  const broadRegistration = worker.registered;
  assert.equal(broadRegistration, undefined);
  worker.grantedOrigins.add(site);
  await worker.onPermissionsAdded([site]);
  assert.deepEqual(await authorize(site), { ok: true });
  const registration = worker.registered;
  assert.ok(registration);
  assert.ok(registration.matches);
  assert.deepEqual([...registration.matches], [site]);
  assert.equal(registration.runAt, "document_idle");
  assert.deepEqual([...worker.local.read<string[]>("authorizedSitePatterns")], [site]);
  worker.grantedOrigins.delete(site);
  await worker.onPermissionsRemoved();
  assert.equal(worker.registered, undefined);
  assert.deepEqual([...worker.local.read<string[]>("authorizedSitePatterns")], []);
});

test("clicks accumulate locally across tabs and remain associated after a legacy rule is edited", async () => {
  const worker = createWorker();
  const ruleId = "selector:#close";
  worker.store.set("siteSelectors:example.com", ["#close"]);
  const record = (hostname: string, tabId: number, ruleIds: string[]) => worker.send({
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
  assert.equal(worker.local.read<Record<string, number>>("siteClickCounts:example.com")[`rule:${ruleId}`], 2);
  assert.equal(worker.local.read<Record<string, number>>("siteClickCounts:example.com")["rule:selector:#other"], 1);
  assert.equal(worker.local.read<Record<string, number>>("siteClickCounts:other.example")[`rule:${ruleId}`], 1);
  assert.equal(worker.store.has("totalClickCount"), false);

  await worker.send({
    type: "edit-site-selector",
    hostname: "example.com",
    selector: "#close",
    replacement: "#new-close",
    name: "关闭广告"
  });
  const rule = worker.store.read<SavedRuleDetails>("siteRuleDetails:example.com")["selector:#new-close"];
  assert.deepEqual(structuredClone(rule), { id: ruleId, name: "关闭广告" });
  await record("example.com", 2, [rule.id]);
  assert.equal(worker.local.get("totalClickCount"), 5);
  assert.equal(worker.local.read<Record<string, number>>("siteClickCounts:example.com")[`rule:${ruleId}`], 3);
});

test("records the latest click time locally by rule ID and omits it from backups", async () => {
  const firstClick = Date.UTC(2026, 10, 25, 8, 0);
  const laterClick = firstClick + 60000;
  let now = firstClick;
  const worker = createWorker(() => now);
  const hostname = "example.com";
  const selector = "#close";
  const id = "selector:#close";
  const key = `rule:${id}`;
  const times = "siteLastClickTimes:example.com";
  worker.store.set("siteSelectors:example.com", [selector]);
  worker.local.set("siteClickCounts:example.com", { [key]: 3 });
  assert.equal(worker.local.has(times), false);
  const record = (tabId: number, host = hostname) => worker.send(
    { type: "click-record", ruleIds: [id] }, { url: `https://${host}/`, tab: { id: tabId } }
  );
  const first = record(1);
  now = laterClick;
  const second = record(2);
  now = firstClick + 500;
  await Promise.all([first, second, record(3, "other.example")]);
  assert.equal(worker.local.read<Record<string, number>>("siteClickCounts:example.com")[key], 5);
  assert.equal(worker.local.read<Record<string, number>>(times)[key], laterClick);
  assert.equal(worker.local.read<Record<string, number>>("siteLastClickTimes:other.example")[key], now);
  assert.equal(worker.store.has(times), false);

  await worker.send({ type: "edit-site-selector", hostname, selector, replacement: "#new", expectedId: id });
  const saved = worker.store.read<SavedRuleDetails>("siteRuleDetails:example.com")["selector:#new"];
  assert.equal(saved.id, id);
  assert.equal(worker.local.read<Record<string, number>>(times)[`rule:${saved.id}`], laterClick);
  assert.deepEqual(worker.backup().sites[0].rules, [
    { selector: "#new", name: "", paused: false, pathPrefix: "", maxClicks: 0 }
  ]);
});
