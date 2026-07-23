/**
 * AmizonePlus — content script for s.amizone.net.
 *
 * Amizone is an ASP.NET app that behaves like a SPA: the URL sits at /Home
 * while page content (My Courses table, semester switches, modals) is swapped
 * in via AJAX. So nothing here assumes the DOM is settled at load time —
 * discovery is driven by a MutationObserver, and click interception is a
 * single *delegated* capture-phase listener on `document`. Delegation matters:
 * per-element listeners would be silently dropped every time ASP.NET re-renders
 * the table (e.g. on semester change), whereas one document-level listener
 * survives any amount of innerHTML churn.
 */

"use strict";

(() => {
  const LOG_PREFIX = "[AmizonePlus]";
  const HANDLER_PATTERN = "AzureFileHandler.ashx";

  /** Extension kill-switch, controlled from the toolbar popup. */
  let enabled = true;
  chrome.storage.sync.get({ enabled: true }, (v) => { enabled = v.enabled; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) enabled = changes.enabled.newValue;
  });

  // ---------------------------------------------------------------------------
  // Link discovery (for debuggability, not for interception)
  // ---------------------------------------------------------------------------

  /**
   * Find every element that would trigger an AzureFileHandler download.
   * Deliberately loose: anchors by href, plus anything carrying the URL in an
   * inline onclick (ASP.NET loves `onclick="window.open('...')"`).
   */
  function findHandlerElements(root) {
    const out = new Set();
    root.querySelectorAll(`a[href*="${HANDLER_PATTERN}"]`).forEach((el) => out.add(el));
    root.querySelectorAll("[onclick]").forEach((el) => {
      if ((el.getAttribute("onclick") || "").includes(HANDLER_PATTERN)) out.add(el);
    });
    return [...out];
  }

  let everFoundLinks = false;
  let warnedNoLinks = false;

  /**
   * Scan the page and log what we can see. The click handler doesn't depend on
   * this — its only job is making the extension debuggable against the live
   * site ("is it finding the icons at all?") without opening the code.
   */
  function scan() {
    const links = findHandlerElements(document);
    if (links.length > 0) {
      if (!everFoundLinks) {
        everFoundLinks = true;
        console.info(`${LOG_PREFIX} found ${links.length} file link(s) matching "${HANDLER_PATTERN}".`);
      }
      links.forEach((el) => { el.dataset.amizoneplus = "1"; });
    } else if (!everFoundLinks && !warnedNoLinks && looksLikeCoursesPage()) {
      warnedNoLinks = true;
      console.warn(
        `${LOG_PREFIX} this looks like a courses page but no links matching ` +
        `"${HANDLER_PATTERN}" were found. Amizone's markup may have changed — ` +
        `inspect a syllabus icon and update HANDLER_PATTERN / findHandlerElements() in content.js.`
      );
    }
  }

  /** Cheap heuristic so the "no links found" warning only fires where links
   *  were actually expected, not on the login page or dashboard. */
  function looksLikeCoursesPage() {
    const text = document.body ? document.body.innerText : "";
    return /my courses|course code|session plan|syllabus/i.test(text);
  }

  // ---------------------------------------------------------------------------
  // MutationObserver — re-scan whenever AJAX swaps content in
  // ---------------------------------------------------------------------------

  /**
   * Preferred observation roots, most specific first. Observing a tight
   * container keeps mutation callbacks cheap; document.body is the safe
   * fallback since we can't guarantee Amizone's container ids.
   */
  const CONTAINER_CANDIDATES = ["#main-content", ".page-content", "#content", "main"];

  function startObserver() {
    const root =
      CONTAINER_CANDIDATES.map((s) => document.querySelector(s)).find(Boolean) ||
      document.body;

    // Debounce: ASP.NET partial renders fire dozens of mutations in one burst;
    // one scan 200ms after the burst settles is plenty.
    let timer = null;
    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(scan, 200);
    });
    observer.observe(root, { childList: true, subtree: true });
    scan();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }

  // ---------------------------------------------------------------------------
  // Click interception
  // ---------------------------------------------------------------------------

  document.addEventListener(
    "click",
    (event) => {
      if (!enabled) return;
      // Ignore clicks inside our own popover.
      if (popoverEl && popoverEl.contains(event.target)) return;

      const trigger = findTriggerFromEvent(event);
      if (!trigger) return;

      const fileUrl = extractFileUrl(trigger);
      if (!fileUrl) return;

      // Capture phase + stopImmediatePropagation: beat both the default
      // navigation and any inline onclick the site attached to the same node.
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();

      const meta = extractRowMeta(trigger, fileUrl);
      showPopover(event.clientX, event.clientY, fileUrl, meta);
    },
    true
  );

  /** Walk up from the click target looking for an AzureFileHandler trigger. */
  function findTriggerFromEvent(event) {
    let node = event.target instanceof Element ? event.target : null;
    while (node && node !== document.documentElement) {
      const href = node.getAttribute && node.getAttribute("href");
      const onclick = node.getAttribute && node.getAttribute("onclick");
      if ((href && href.includes(HANDLER_PATTERN)) ||
          (onclick && onclick.includes(HANDLER_PATTERN))) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  /** Pull the actual file URL out of an href or an inline onclick string. */
  function extractFileUrl(el) {
    const href = el.getAttribute("href");
    if (href && href.includes(HANDLER_PATTERN)) {
      try {
        return new URL(href, location.href).href;
      } catch { /* fall through to onclick */ }
    }
    const onclick = el.getAttribute("onclick") || "";
    // Grab the first quoted string containing the handler path, e.g.
    // window.open('https://img.amizone.net/AzureFileHandler.ashx?FileName=...')
    const m = onclick.match(/['"]([^'"]*AzureFileHandler\.ashx[^'"]*)['"]/);
    if (m) {
      try {
        return new URL(m[1], location.href).href;
      } catch { /* unparseable */ }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Row metadata → clean filename
  // ---------------------------------------------------------------------------

  /**
   * Build { courseCode, courseName, docType, ext, cleanName } from the table
   * row around the clicked icon. Everything here is heuristic — cells aren't
   * labelled — so each piece degrades independently to a sane default.
   */
  function extractRowMeta(trigger, fileUrl) {
    const row = trigger.closest("tr");
    const cells = row
      ? [...row.querySelectorAll("td, th")].map((c) => c.innerText.trim()).filter(Boolean)
      : [];

    // Course code: short, starts with letters, ends with digits (e.g. CSE201,
    // BTC 2304). Course name: the longest remaining text cell.
    let courseCode = "";
    let courseName = "";
    for (const text of cells) {
      if (!courseCode && /^[A-Za-z]{2,10}[\s-]?\d{2,5}[A-Za-z]?$/.test(text)) {
        courseCode = text.replace(/[\s-]/g, "");
      } else if (text.length > courseName.length && text.length > 3 && !/^\d+$/.test(text)) {
        courseName = text;
      }
    }

    // File extension comes from the FileName query param — never assume docx.
    let ext = "";
    let docType = "File";
    try {
      const raw = new URL(fileUrl).searchParams.get("FileName") || "";
      const extMatch = raw.match(/\.([A-Za-z0-9]{1,8})$/);
      if (extMatch) ext = extMatch[1].toLowerCase();
      if (/syllabus/i.test(raw)) docType = "Syllabus";
      else if (/session|lesson/i.test(raw)) docType = "SessionPlan";
    } catch { /* keep defaults */ }

    const namePart = toCleanWords(courseName);
    const parts = [courseCode, namePart, docType].filter(Boolean);
    const cleanName = (parts.length ? parts.join("_") : "AmizoneFile") + (ext ? "." + ext : "");

    return { courseCode, courseName, docType, ext, cleanName };
  }

  /** "Data Structures & Algorithms" → "DataStructuresAndAlgorithms" */
  function toCleanWords(s) {
    return s
      .replace(/&/g, " And ")
      .replace(/[^A-Za-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join("");
  }

  // ---------------------------------------------------------------------------
  // Popover UI
  // ---------------------------------------------------------------------------

  let popoverEl = null;
  let dismissHandlersBound = false;

  const EYE_SVG =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2.2"/></svg>';
  const DOWN_SVG =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2.5v7m0 0 3-3m-3 3-3-3"/><path d="M2.5 11.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1"/></svg>';
  const SPINNER_SVG =
    '<svg class="amzp-spinner" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="6" opacity="0.25"/><path d="M14 8a6 6 0 0 0-6-6"/></svg>';

  function showPopover(clientX, clientY, fileUrl, meta) {
    closePopover();

    popoverEl = document.createElement("div");
    popoverEl.className = "amzp-popover";
    popoverEl.innerHTML = `
      <button type="button" class="amzp-btn" data-action="view">${EYE_SVG}<span>View</span></button>
      <button type="button" class="amzp-btn" data-action="download">${DOWN_SVG}<span>Download</span></button>
    `;
    document.body.appendChild(popoverEl);

    // Anchor near the cursor (position: fixed, so client coords are viewport
    // coords already), then clamp so it never overflows the viewport edge.
    const rect = popoverEl.getBoundingClientRect();
    const x = Math.min(clientX + 4, window.innerWidth - rect.width - 8);
    const y = Math.min(clientY + 8, window.innerHeight - rect.height - 8);
    popoverEl.style.left = Math.max(8, x) + "px";
    popoverEl.style.top = Math.max(8, y) + "px";

    // Entrance on the next frame so the transition actually runs.
    requestAnimationFrame(() => popoverEl && popoverEl.classList.add("amzp-in"));

    popoverEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn || popoverEl.classList.contains("amzp-busy")) return;
      setBusy(btn);
      if (btn.dataset.action === "view") {
        viewFile(fileUrl, meta).catch((err) => fallback(fileUrl, err));
      } else {
        downloadFile(fileUrl, meta).catch((err) => fallback(fileUrl, err));
      }
    });

    if (!dismissHandlersBound) {
      dismissHandlersBound = true;
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closePopover();
      });
      // mousedown, not click: our own intercepted click has already happened.
      document.addEventListener("mousedown", (e) => {
        if (popoverEl && !popoverEl.contains(e.target)) closePopover();
      });
    }
  }

  function setBusy(btn) {
    popoverEl.classList.add("amzp-busy");
    btn.querySelector("svg").outerHTML = SPINNER_SVG;
  }

  function closePopover() {
    if (popoverEl) {
      popoverEl.remove();
      popoverEl = null;
    }
  }

  /** Any failure lands here: hand the click back to the site's own behavior
   *  (a plain navigation to the handler URL → raw download) so the user is
   *  never left with nothing. */
  function fallback(fileUrl, err) {
    console.warn(`${LOG_PREFIX} falling back to direct download:`, err);
    closePopover();
    location.assign(fileUrl);
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Ask the service worker to fetch the file (it can cross origins with the
   *  user's cookies; we can't — see background.js) and rebuild the bytes. */
  async function fetchViaBackground(fileUrl) {
    const res = await chrome.runtime.sendMessage({ type: "fetchFile", url: fileUrl });
    if (!res || !res.ok) throw new Error(res ? res.error : "No response from service worker");
    const binary = atob(res.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, contentType: res.contentType };
  }

  async function viewFile(fileUrl, meta) {
    if (meta.ext === "pdf") {
      // PDFs: blob URL in a new tab → Chrome's native viewer.
      const { bytes } = await fetchViaBackground(fileUrl);
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) throw new Error("Popup blocked");
      closePopover();
      return;
    }

    if (meta.ext === "docx") {
      // docx: fetched with the user's credentials, converted locally with
      // mammoth.js in viewer.html — nothing ever leaves the machine (this is
      // why we don't use Google Docs Viewer: it can't authenticate against
      // img.amizone.net, and it would mean shipping the file to Google).
      const res = await chrome.runtime.sendMessage({
        type: "viewDocx",
        url: fileUrl,
        fileName: meta.cleanName,
      });
      if (!res || !res.ok) throw new Error(res ? res.error : "No response from service worker");
      closePopover();
      return;
    }

    // Formats we can't render (.doc, .pptx, ...): a clean-named download is
    // still strictly better than the site's GUID download.
    await downloadFile(fileUrl, meta);
  }

  async function downloadFile(fileUrl, meta) {
    const { bytes, contentType } = await fetchViaBackground(fileUrl);
    const blob = new Blob([bytes], { type: contentType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.cleanName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the download a moment to start before revoking the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    closePopover();
  }
})();
