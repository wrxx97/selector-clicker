import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { getAccessToken, submitForReview } from "../scripts/submit-chrome.mjs";

const release = {
  archive: Buffer.from("test zip"),
  version: "1.0.1",
  publisherId: "test-publisher",
  itemId: "a".repeat(32),
  accessToken: "mock-access-token"
};

function mockApi(responses) {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, options });
      assert.ok(responses.length > 0, "unexpected API request");
      return new Response(JSON.stringify(responses.shift()));
    }
  };
}

test("exchanges a signed service account assertion scoped to Chrome Web Store", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const email = "release@example.iam.gserviceaccount.com";
  const account = JSON.stringify({
    type: "service_account",
    client_email: email,
    private_key: privateKey.export({ format: "pem", type: "pkcs8" })
  });
  const api = mockApi([{ access_token: "mock-access-token" }]);
  assert.equal(await getAccessToken(account, api.request), "mock-access-token");
  const [{ url, options }] = api.calls;
  assert.equal(url, "https://oauth2.googleapis.com/token");
  assert.equal(options.body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [header, payload, signature] = options.body.get("assertion").split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.iss, email);
  assert.equal(claims.aud, url);
  assert.equal(claims.scope, "https://www.googleapis.com/auth/chromewebstore");
  assert.ok(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")));
});

test("waits for an asynchronous ZIP upload before requesting staged review", async () => {
  const api = mockApi([
    {},
    { uploadState: "IN_PROGRESS" },
    { lastAsyncUploadState: "NOT_FOUND" },
    { lastAsyncUploadState: "SUCCEEDED" },
    {},
    { state: "PENDING_REVIEW" }
  ]);
  const result = await submitForReview(release, { request: api.request, delay: async () => {} });
  assert.equal(result.state, "PENDING_REVIEW");
  assert.deepEqual(api.calls.map(({ url }) => url.split(":").at(-1)), [
    "fetchStatus", "upload", "fetchStatus", "fetchStatus", "fetchStatus", "publish"
  ]);
  const [, upload, , , , publish] = api.calls;
  assert.match(upload.url, /\/upload\/v2\/publishers\//);
  assert.deepEqual(upload.options.body, release.archive);
  assert.deepEqual(JSON.parse(publish.options.body), { publishType: "STAGED_PUBLISH", skipReview: false });
});

test("never calls publish when a review or staged revision appears", async () => {
  for (const state of ["PENDING_REVIEW", "STAGED"]) {
    const revision = { submittedItemRevisionStatus: { state } };
    const existing = mockApi([revision]);
    await assert.rejects(submitForReview(release, existing), new RegExp(state));
    assert.equal(existing.calls.length, 1);

    const raced = mockApi([{}, { uploadState: "SUCCEEDED", crxVersion: release.version }, revision]);
    await assert.rejects(submitForReview(release, raced), new RegExp(state));
    assert.equal(raced.calls.length, 3);
    assert.ok(raced.calls.every(({ url }) => !url.endsWith(":publish")));
  }
});

test("keeps a failed upload out of the review queue", async () => {
  const api = mockApi([{}, { uploadState: "FAILED" }]);
  await assert.rejects(submitForReview(release, api), /upload did not succeed \(FAILED\)/);
  assert.equal(api.calls.length, 2);
});
