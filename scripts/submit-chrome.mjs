import { sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STORE_API = "https://chromewebstore.googleapis.com";
const STORE_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const UPLOAD_POLL_LIMIT = 30;
const UPLOAD_POLL_DELAY = 3000;

async function requestJson(request, url, options, label) {
  const response = await request(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.error?.message || body?.error_description;
    const detail = typeof message === "string" ? ` — ${message.replace(/\s+/g, " ").slice(0, 600)}` : "";
    throw new Error(`${label} failed with HTTP ${response.status}${detail}`);
  }
  if (!body || typeof body !== "object") throw new Error(`${label} returned invalid JSON.`);
  return body;
}

export async function getAccessToken(serviceAccountJson, request = fetch) {
  let account;
  try {
    account = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("Set CWS_SERVICE_ACCOUNT_JSON to the Google service account key JSON.");
  }
  if (account?.type !== "service_account" || !account.client_email || !account.private_key) {
    throw new Error("CWS_SERVICE_ACCOUNT_JSON must contain a service account email and private key.");
  }

  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = { alg: "RS256", typ: "JWT", ...(account.private_key_id ? { kid: account.private_key_id } : {}) };
  const claims = { iss: account.client_email, scope: STORE_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 };
  const unsigned = `${encode(header)}.${encode(claims)}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), account.private_key).toString("base64url");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsigned}.${signature}`
  });
  const response = await requestJson(request, TOKEN_URL, { method: "POST", body }, "Google authentication");
  if (typeof response.access_token !== "string" || !response.access_token) {
    throw new Error("Google authentication did not return an access token.");
  }
  return response.access_token;
}

function ensureNoPendingSubmission(status) {
  const state = status.submittedItemRevisionStatus?.state;
  if (state === "PENDING_REVIEW" || state === "STAGED") {
    throw new Error(`The store already has a ${state} revision. Resolve it in the Developer Dashboard before submitting another version.`);
  }
}

export async function submitForReview(
  { archive, version, publisherId, itemId, accessToken },
  { request = fetch, delay = sleep } = {}
) {
  if (!publisherId || !/^[a-p]{32}$/.test(itemId || "")) {
    throw new Error("Set CWS_PUBLISHER_ID and the 32-character CWS_ITEM_ID from the Developer Dashboard.");
  }
  const resource = `v2/publishers/${encodeURIComponent(publisherId)}/items/${itemId}`;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const fetchStatus = () => requestJson(request, `${STORE_API}/${resource}:fetchStatus`, { headers }, "Store status");

  ensureNoPendingSubmission(await fetchStatus());
  const upload = await requestJson(request, `${STORE_API}/upload/${resource}:upload`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/zip" },
    body: archive
  }, "ZIP upload");

  if (upload.crxVersion && upload.crxVersion !== version) {
    throw new Error(`The store received version ${upload.crxVersion}, expected ${version}.`);
  }
  let state = upload.uploadState;
  for (let attempt = 0; state === "IN_PROGRESS" && attempt < UPLOAD_POLL_LIMIT; attempt++) {
    await delay(UPLOAD_POLL_DELAY);
    const status = await fetchStatus();
    ensureNoPendingSubmission(status);
    const pendingState = status.lastAsyncUploadState;
    if (pendingState && pendingState !== "NOT_FOUND") state = pendingState;
  }
  if (state !== "SUCCEEDED") throw new Error(`Chrome Web Store upload did not succeed (${state || "no upload state"}).`);

  // A call to publish can release a revision that is already staged.
  ensureNoPendingSubmission(await fetchStatus());
  return requestJson(request, `${STORE_API}/${resource}:publish`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ publishType: "STAGED_PUBLISH", skipReview: false })
  }, "Review submission");
}

async function main() {
  const archivePath = process.argv[2];
  if (!archivePath) throw new Error("Usage: node scripts/submit-chrome.mjs <extension.zip>");
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const archive = await readFile(archivePath);
  const result = await submitForReview({
    archive,
    version: manifest.version,
    publisherId: process.env.CWS_PUBLISHER_ID,
    itemId: process.env.CWS_ITEM_ID,
    accessToken: await getAccessToken(process.env.CWS_SERVICE_ACCOUNT_JSON)
  });
  console.log(`Submitted ${manifest.version} for review with manual publishing. Store state ${result.state || "unavailable"}.`);
  console.log("Review and publish in https://chrome.google.com/webstore/devconsole");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
