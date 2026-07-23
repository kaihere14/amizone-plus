/**
 * AmizonePlus — background service worker.
 *
 * Why this file exists at all: in Manifest V3, a fetch() issued from a content
 * script runs under the *page's* origin (s.amizone.net). The files live on
 * img.amizone.net, which does not send CORS headers, so that fetch dies in the
 * browser. The service worker, however, fetches under the extension's own
 * identity, and because we hold host_permissions for img.amizone.net it may
 * fetch cross-origin AND attach the user's cookies for that domain
 * (credentials: "include"). So every file fetch is proxied through here.
 *
 * Bytes cross the messaging boundary as base64 — chrome.runtime messaging is
 * JSON-serialized, so ArrayBuffers can't be passed directly. Syllabus files
 * are small (tens to hundreds of KB), so the encode cost is negligible.
 */

"use strict";

/** Storage key prefix for docs handed off to the viewer page. */
const DOC_KEY_PREFIX = "amizoneplus_doc_";

/** How long a stored doc may sit unclaimed before cleanup (ms). */
const DOC_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch a file with the user's own cookies and return its bytes as base64.
 * Throws on non-2xx so callers can fall back to the site's default behavior.
 */
async function fetchFileAsBase64(url) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const buf = await res.arrayBuffer();
  // An empty body is exactly the broken-backend case we're papering over —
  // treat it as a failure so the content script falls back cleanly.
  if (buf.byteLength === 0) {
    throw new Error("Empty response body");
  }
  return {
    base64: arrayBufferToBase64(buf),
    contentType: res.headers.get("content-type") || "",
    byteLength: buf.byteLength,
  };
}

/** Chunked conversion — String.fromCharCode.apply on the whole buffer would
 *  blow the call-stack argument limit for files past ~100KB. */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Remove viewer hand-off entries older than DOC_TTL_MS (e.g. the user closed
 *  the tab before the viewer loaded, or the viewer crashed before cleanup). */
async function sweepStaleDocs() {
  const all = await chrome.storage.local.get(null);
  const now = Date.now();
  const stale = Object.keys(all).filter(
    (k) => k.startsWith(DOC_KEY_PREFIX) && now - (all[k].storedAt || 0) > DOC_TTL_MS
  );
  if (stale.length) await chrome.storage.local.remove(stale);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetchFile") {
    // Used by the content script for PDF-view and for downloads.
    fetchFileAsBase64(msg.url)
      .then((data) => sendResponse({ ok: true, ...data }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }

  if (msg.type === "viewDocx") {
    // Fetch + stash + open the viewer entirely from the worker so the large
    // base64 payload makes one hop (worker -> storage) instead of bouncing
    // through the content script.
    (async () => {
      try {
        await sweepStaleDocs();
        const data = await fetchFileAsBase64(msg.url);
        const key = DOC_KEY_PREFIX + Date.now();
        await chrome.storage.local.set({
          [key]: {
            base64: data.base64,
            fileName: msg.fileName,
            sourceUrl: msg.url,
            storedAt: Date.now(),
          },
        });
        await chrome.tabs.create({
          url: chrome.runtime.getURL("viewer.html") + "?key=" + encodeURIComponent(key),
          // Open next to the Amizone tab rather than at the end of the strip.
          index: sender.tab ? sender.tab.index + 1 : undefined,
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
});
