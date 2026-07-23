// AmizonePlus popup: a single enable/disable switch persisted in
// chrome.storage.sync. The content script reads it on load and listens for
// changes, so flipping this takes effect immediately — no page reload needed.

"use strict";

const toggle = document.getElementById("toggle");

chrome.storage.sync.get({ enabled: true }, ({ enabled }) => {
  toggle.checked = enabled;
});

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ enabled: toggle.checked });
});
