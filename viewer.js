/**
 * AmizonePlus — viewer page logic.
 *
 * The content script never touches the file bytes for docx viewing; the
 * service worker fetches them (with the user's cookies) and parks them in
 * chrome.storage.local under a one-shot key, then opens this page with
 * ?key=<that key>. We pick the bytes up, convert to HTML locally with the
 * bundled mammoth.js, render, and delete the storage entry so files don't
 * accumulate on disk. Conversion happens here — not in the content script —
 * so the 600KB mammoth bundle is only ever loaded in this tab, never injected
 * into every Amizone page view.
 */

"use strict";

const stateEl = document.getElementById("state");
const docEl = document.getElementById("doc");
const filenameEl = document.getElementById("filename");

function fail(message) {
  stateEl.innerHTML = "";
  stateEl.textContent = message;
}

async function main() {
  const key = new URLSearchParams(location.search).get("key");
  if (!key || !key.startsWith("amizoneplus_doc_")) {
    fail("No document to display. Open a file from Amizone to use this viewer.");
    return;
  }

  const stored = (await chrome.storage.local.get(key))[key];
  if (!stored || !stored.base64) {
    // Refresh after the one-shot entry was consumed, or the TTL sweep got it.
    fail("This document is no longer available — go back to Amizone and open it again.");
    return;
  }

  document.title = stored.fileName + " — AmizonePlus";
  filenameEl.textContent = stored.fileName;

  // base64 → ArrayBuffer for mammoth.
  const binary = atob(stored.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  try {
    const result = await window.mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
    // mammoth reports non-fatal issues (unsupported styles etc.) as messages;
    // surface them in the console rather than cluttering the reading view.
    if (result.messages && result.messages.length) {
      console.info("[AmizonePlus] mammoth conversion notes:", result.messages);
    }
    docEl.innerHTML = result.value;
    stateEl.remove();
  } catch (err) {
    console.error("[AmizonePlus] docx conversion failed:", err);
    fail("Could not convert this document. Try the Download option on Amizone instead.");
  } finally {
    // One-shot: the bytes have served their purpose either way.
    chrome.storage.local.remove(key);
  }
}

main();
