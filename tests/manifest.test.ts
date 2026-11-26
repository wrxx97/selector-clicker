import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { manifestLocaleAssets, manifestLocalePath } from "../src/build/runtime-scripts";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as chrome.runtime.ManifestV3;

test("declares Manifest V3 with optional host access and no static content scripts", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(!manifest.permissions.includes("tabs"));
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test("localizes the browser-managed extension name and description", () => {
  assert.equal(manifest.default_locale, "en");
  assert.equal(manifest.name, "__MSG_appName__");
  assert.equal(manifest.description, "__MSG_appDescription__");
  assert.equal(manifest.action?.default_title, manifest.name);
  const catalogs = Object.fromEntries(manifestLocaleAssets().map(({ fileName, source }) => [fileName, JSON.parse(source)]));
  assert.equal(catalogs[manifestLocalePath("en")].appName.message, "Selector Clicker");
  assert.equal(catalogs[manifestLocalePath("zh_CN")].appName.message, "元素自动点击");
  for (const messages of Object.values(catalogs)) assert.ok(messages.appDescription.message);
});

test("declares the extension popup and service worker", () => {
  assert.equal(manifest.action?.default_popup, "popup.html");
  assert.equal(manifest.background?.service_worker, "service-worker.js");
});

test("declares the rules manager as an options page that opens in a tab", () => {
  assert.deepEqual(manifest.options_ui, { page: "rules.html", open_in_tab: true });
  assert.ok(manifest.options_ui);
  assert.ok(existsSync(new URL(`../src/${manifest.options_ui.page}`, import.meta.url)));
});
