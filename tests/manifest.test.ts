import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

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

test("declares the extension popup and service worker", () => {
  assert.equal(manifest.action?.default_popup, "popup.html");
  assert.equal(manifest.background?.service_worker, "service-worker.js");
});

test("declares the rules manager as an options page that opens in a tab", () => {
  assert.deepEqual(manifest.options_ui, { page: "rules.html", open_in_tab: true });
  assert.ok(manifest.options_ui);
  assert.ok(existsSync(new URL(`../${manifest.options_ui.page}`, import.meta.url)));
});
