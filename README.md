# kaihere14/amizone-plus

A browser extension that integrates with the AMIZone platform. It provides a popup interface, a content script, and a dedicated viewer page.

## Table of Contents

- Features
- Requirements
- Installation
- Configuration
- Usage
- Project Structure

## Features

- Provides a browser extension popup for AMIZone interactions.
- Injects content and styling into AMIZone pages.
- Opens a dedicated viewer page for specific AMIZone content.
- Includes a bundled library for document conversion.

## Requirements

- A browser that supports Manifest V3 extensions.

## Installation

1. Clone the repository.
2. Load the extension in your browser.

```
npm install
```

```
# Load the extension
# Chrome / Edge
chrome://extensions/
# Enable Developer mode, then click Load unpacked and select this directory.
# Firefox
about:debugging#/runtime/this-firefox
# Click Load Temporary Add-on and select manifest.json.
```

## Configuration

The extension reads its configuration from `manifest.json`. Review this file to understand permissions, content scripts, and popup definitions.

## Usage

### Popup

Open the extension popup to access the AMIZone tools.

```
# Open the popup
chrome-extension://<extension-id>/popup.html
```

### Content Script

The extension applies `content.css` and executes `content.js` on matching AMIZone pages.

### Viewer

Launch the standalone viewer page.

```
# Open the viewer
viewer.html
```

## Project Structure

| Path | Description |
|------|-------------|
| `manifest.json` | Extension manifest defining permissions and entry points. |
| `popup.html` | HTML for the extension popup. |
| `popup.css` | Styles for the extension popup. |
| `popup.js` | Script for the extension popup. |
| `content.js` | Content script injected into matching pages. |
| `content.css` | Styles applied by the content script. |
| `background.js` | Background script for the extension. |
| `viewer.html` | HTML for the standalone viewer page. |
| `viewer.js` | Script for the standalone viewer page. |
| `icons/` | Extension icons in multiple resolutions. |
| `lib/mammoth.browser.min.js` | Bundled Mammoth.js library for document conversion. |