# WeChat Miniprogram MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a native WeChat Mini Program MVP for AI财舵.

**Architecture:** Keep the web app intact and add a standalone `miniprogram/` project. The Mini Program uses local storage and a small CommonJS ledger core adapted from the existing web ledger core.

**Tech Stack:** WeChat Mini Program native WXML/WXSS/JS, CommonJS utilities, `wx` local storage, Node test runner.

## Global Constraints

- Do not wrap the hosted web app in `web-view`.
- Keep the first release positioned as a personal bookkeeping tool, not banking, investment, or financial advice.
- Do not claim automatic PDF recognition in the Mini Program until a cloud OCR/backend path exists.
- Keep all user ledger data local to the Mini Program for this MVP.

---

## File Structure

- `miniprogram/project.config.json`: WeChat Developer Tools project metadata.
- `miniprogram/app.json`, `app.js`, `app.wxss`, `sitemap.json`: app shell and shared styling.
- `miniprogram/utils/ledger-core.js`: Mini Program-safe ledger calculation and recommendation functions.
- `miniprogram/utils/storage.js`: local storage helpers and default accounts.
- `miniprogram/pages/index/*`: dashboard and quick entry.
- `miniprogram/pages/records/*`: transaction list and multi-select deletion.
- `miniprogram/pages/accounts/*`: account creation, editing, and opening balances.
- `miniprogram/pages/import/*`: bill import entry point and OCR readiness copy.
- `tests/wechat-miniprogram.test.mjs`: project structure and core behavior checks.

---

### Task 1: Add Structure and Core Tests

- [x] Write `tests/wechat-miniprogram.test.mjs`.
- [x] Run it and confirm it fails because `miniprogram/` is missing.

### Task 2: Add Mini Program Core and App Shell

- [x] Add `project.config.json`, `app.json`, `app.js`, `app.wxss`, and `sitemap.json`.
- [x] Add `utils/ledger-core.js` and `utils/storage.js`.
- [x] Run `node --test tests/wechat-miniprogram.test.mjs` and confirm core tests pass.

### Task 3: Add Pages

- [x] Add index, records, accounts, and import page files.
- [x] Run structure tests and full Node tests.

### Task 4: Final Verification

- [x] Run syntax checks on Mini Program JavaScript files.
- [x] Run all available Node tests.
- [x] Commit, merge to `master`, and push.
