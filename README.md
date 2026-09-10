# AmizonePlus

AmizonePlus is a Manifest V3 browser extension for Amizone (`s.amizone.net`) that replaces default file downloads with an interactive viewing and clean downloading experience. It detects course document links, extracts course metadata to generate descriptive file names, and allows viewing PDFs and `.docx` files directly in the browser.

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Project Structure](#project-structure)

## Features

- **Link Interception & Mutation Handling**: Uses a document-level click listener and a `MutationObserver` to intercept file triggers matching `AzureFileHandler.ashx`, retaining functionality across ASP.NET table updates and partial page reloads.
- **In-Page Action Popover**: Displays a floating popover UI with **View** and **Download** actions upon clicking syllabus or document icons.
- **In-Browser Document Viewer**:
  - **PDFs**: Fetches PDF files and opens them in a browser tab using Blob URLs.
  - **DOCX Files**: Proxies file bytes via the background service worker to `chrome.storage.local` and converts them to HTML locally using Mammoth.js in a dedicated viewer tab (`viewer.html`).
- **Automated File Renaming**: Parses course rows to reconstruct clean filenames following the pattern `[CourseCode]_[CourseName]_[DocType].[ext]` rather than generic backend identifiers.
- **Authenticated Proxy Fetching**: Executes fetches through `background.js` using credentials (`credentials: "include"`) to bypass CORS restrictions on `img.amizone.net`.
- **Extension Toggle**: Supports real-time enabling/disabling via `chrome.storage.sync` through the extension toolbar popup.

## Requirements

- Any Chromium-based browser supporting Manifest V3 extensions (Google Chrome, Microsoft Edge, Brave, Opera).

## Installation

1. Clone or download this repository.
2. Open your browser and go to the extensions management page (`chrome://extensions`).
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the repository root folder containing `manifest.json`.

## Usage

1. Navigate to Amizone (`s.amizone.net`) and open a page containing course documents or session plans.
2. Click any course syllabus or file link.
3. Select an option from the popover:
   - **View**: Opens PDFs in a new tab or converts `.docx` documents to HTML for reading inside the browser.
   - **Download**: Saves the file locally with its formatted course name.
4. Click the AmizonePlus icon in the browser toolbar to switch the extension on or off.

## Project Structure

```
├── background.js              # Manifest V3 service worker proxying authenticated requests and opening viewer tabs
├── content.js                 # Content script for link detection, metadata parsing, and popover UI
├── content.css                # Styling for the in-page popover UI
├── popup.html                 # Extension popup interface
├── popup.js                   # Extension popup enable/disable state management
├── popup.css                  # Styling for the extension toolbar popup
├── viewer.html                # Local document reader interface for DOCX rendering
├── viewer.js                  # Document viewer logic using Mammoth.js
├── lib/
│   └── mammoth.browser.min.js # Client-side DOCX-to-HTML conversion library
├── icons/                     # Web extension icons
└── manifest.json              # Extension manifest definition
```