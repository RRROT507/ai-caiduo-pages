# File AI Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace paste-text import with local file upload, recognition preview, and confirm-to-ledger flow.

**Architecture:** Add a focused `assets/ledger-importer.mjs` module for file reading, optional backend AI handoff, and local fallback parsing. Update `assets/app.js` to maintain pending import state and save recognized transactions only after user confirmation.

**Tech Stack:** Static HTML/CSS/ES modules on GitHub Pages, browser `File` APIs, optional HTTP AI endpoint, Node test runner, Playwright smoke test with Microsoft Edge when available.

## Global Constraints

- Do not put AI API keys in front-end code.
- Keep all saved ledger data in browser-local storage.
- Remove the visible text-paste import area from the product UI.
- Show recognized transactions for user confirmation before saving.
- Preserve existing manual entry, monthly summary, CSV export, privacy, support, and PWA behavior.

---

### Task 1: File Importer Module

**Files:**
- Create: `assets/ledger-importer.mjs`
- Test: `tests/ledger-importer.test.mjs`

**Interfaces:**
- Consumes: `parseLedgerText(text, options)` and `inferCategory(description, direction)` from `assets/ledger-core.mjs`.
- Produces: `analyzeLedgerFile(file, options)` returning `{ transactions, mode, message }`.

- [ ] **Step 1: Write failing tests**

Create tests that call `analyzeLedgerFile()` with a local text file and with a mocked AI endpoint response.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tests/ledger-importer.test.mjs`

- [ ] **Step 3: Implement importer**

Read text-like files with `File.text()`, attempt lightweight PDF text extraction for text-bearing PDFs, call an optional endpoint when configured, normalize returned transactions, and fallback to local parsing when no endpoint is configured.

- [ ] **Step 4: Run tests to verify pass**

Run: `node --test tests/ledger-importer.test.mjs`

### Task 2: Upload UI And Pending Preview

**Files:**
- Modify: `index.html`
- Modify: `assets/app.js`
- Modify: `assets/styles.css`
- Test: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `analyzeLedgerFile(file, options)`.
- Produces: upload controls, pending rows, confirm import action, discard import action.

- [ ] **Step 1: Write failing browser smoke check**

Update the browser smoke test so it uploads a local statement file, clicks recognition, sees pending rows, confirms import, and sees ledger rows.

- [ ] **Step 2: Run smoke check to verify failure**

Run: `node --test tests/legacy-browser-smoke.test.mjs`

- [ ] **Step 3: Implement upload UI**

Replace the paste textarea with file input, recognition button, status text, and pending preview table. Remove `pasteInput` and `sampleButton` UI bindings.

- [ ] **Step 4: Run smoke check to verify pass**

Run: `node --test tests/legacy-browser-smoke.test.mjs`

### Task 3: Cache And Public Copy

**Files:**
- Modify: `service-worker.js`
- Modify: `support.html`
- Modify: `privacy.html`

**Interfaces:**
- Consumes: new importer asset path.
- Produces: refreshed PWA cache and public copy matching upload-based import.

- [ ] **Step 1: Update cache**

Add `assets/ledger-importer.mjs` to the app shell and bump the cache name.

- [ ] **Step 2: Update public copy**

Make support and privacy pages say the app supports local file upload, optional AI recognition endpoint, and no long-term original-file storage.

- [ ] **Step 3: Verify static assets**

Run JSON/static asset checks and browser smoke tests before commit.
