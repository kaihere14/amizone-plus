
# 🎓 AmizonePlus

Chrome extension (Manifest V3) that fixes the broken syllabus / session-plan "View" icons on Amizone's My Courses page. Instead of an empty modal or a `.docx` download named after a GUID, you get a small View / Download popover:

- **View** — PDFs open in Chrome's native viewer; `.docx` files are fetched with your own session cookies, converted locally with mammoth.js, and shown in a clean reading-mode page. Nothing is sent to any third-party service.
- **Download** — Same file, saved with a readable name built from the course row, e.g. `CSE201_DataStructuresAndAlgorithms_Syllabus.docx`.

If anything fails (auth expired, empty response from Amizone's backend, unsupported format), the click falls back to the site's original download behavior, so you're never stuck. You can also quickly enable or disable the extension on the fly using the toggle switch in the toolbar popup.
## Load unpacked in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `amizone-plus/` folder.
4. Log in at `https://s.amizone.net`, go to **My Courses**, and click a
   syllabus/session-plan icon — the popover should appear at the cursor.

Debugging: the content script logs under the `[AmizonePlus]` prefix in the
page console. If it warns that no `AzureFileHandler.ashx` links were found on
a courses page, Amizone's markup has changed — inspect a syllabus icon and
adjust `HANDLER_PATTERN` / `findHandlerElements()` in `content.js`.

## mammoth.js bundling

`lib/mammoth.browser.min.js` is bundled locally (MV3 forbids remote code, and
we don't want a CDN dependency anyway). It's already included in this repo;
to update or re-fetch it, download the browser build from npm via unpkg:

```
curl -L -o lib/mammoth.browser.min.js https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js
```

(or grab `mammoth.browser.min.js` from the `mammoth` npm package's tarball —
it ships in the package root). The library is only loaded by `viewer.html`,
never injected into Amizone pages.

## Why there's a background.js

The file host (`img.amizone.net`) is a different origin from the portal and
sends no CORS headers, so a `fetch()` from the content script is blocked by
the browser. The service worker holds host permissions for both domains and
fetches with `credentials: "include"`, so downloads work with your existing
Amizone session. All file traffic goes browser → Amizone directly; the
extension talks to nothing else.
