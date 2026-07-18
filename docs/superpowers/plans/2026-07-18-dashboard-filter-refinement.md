# Dashboard Filter Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dashboard month checkbox filtering with a continuous month range and replace account checkbox filtering with a dropdown.

**Architecture:** Keep the existing pure ledger helpers and change only the browser state and controls. `assets/app.js` will derive an inclusive month list from `startMonth` and `endMonth`, then pass it to the existing filtering helpers with either no account filter or one selected account id.

**Tech Stack:** Static HTML, CSS, browser JavaScript modules, Node.js built-in test runner, Playwright smoke test with Microsoft Edge.

## Global Constraints

- Preserve existing account management.
- Preserve manual transaction account selection.
- Preserve import account selection.
- Remove the dashboard month checkbox list.
- Use a continuous start/end month range in the existing month filter area.
- Use a dropdown for dashboard account filtering.
- Bump the service-worker cache version before deployment.

---

### Task 1: Browser Test for Refined Filters

**Files:**
- Modify: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Expects: `#startMonthInput`
- Expects: `#endMonthInput`
- Expects: `#accountFilterInput`
- Expects: no visible `#monthFilterList` or `#accountFilterList`

- [ ] **Step 1: Write the failing browser test**

Change the smoke test so it:

```js
assert.equal(await page.locator("#monthFilterList").count(), 0);
assert.equal(await page.locator("#accountFilterList").count(), 0);
await page.fill("#startMonthInput", "2026-07");
await page.fill("#endMonthInput", "2026-07");
await page.selectOption("#accountFilterInput", "all");
```

After adding July and August manual transactions, change the multi-month part to:

```js
await page.fill("#endMonthInput", "2026-08");
await page.dispatchEvent("#endMonthInput", "change");
assert.equal(await page.locator("#transactionRows tr").count(), 2);
assert.equal(await page.locator("#transactionCount").textContent(), "2");

await page.selectOption("#accountFilterInput", "wechat");
assert.equal(await page.locator("#transactionRows tr").count(), 1);
assert.ok(await page.locator("#transactionRows").getByText("微信").isVisible());
assert.equal(await page.locator("#transactionCount").textContent(), "1");

await page.selectOption("#accountFilterInput", "all");
```

Change the later支付宝 assertion to:

```js
await page.selectOption("#accountFilterInput", "alipay");
```

- [ ] **Step 2: Run the browser test and confirm it fails**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: failure because the new range inputs and account dropdown do not exist yet.

---

### Task 2: Implement Refined Dashboard Filters

**Files:**
- Modify: `index.html`
- Modify: `assets/app.js`
- Modify: `assets/styles.css`
- Modify: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Produces: `#startMonthInput`
- Produces: `#endMonthInput`
- Produces: `#accountFilterInput`
- Removes: `#monthFilterList`
- Removes: `#accountFilterList`

- [ ] **Step 1: Update dashboard markup**

Replace the old month input and dashboard checkbox filter area in `index.html` with:

```html
<div class="dashboard-filters" aria-label="看板筛选">
  <label class="month-control">
    <span>开始月份</span>
    <input id="startMonthInput" type="month" />
  </label>
  <label class="month-control">
    <span>结束月份</span>
    <input id="endMonthInput" type="month" />
  </label>
  <label class="account-filter-control">
    <span>账户</span>
    <select id="accountFilterInput" aria-label="筛选账户"></select>
  </label>
</div>
```

- [ ] **Step 2: Update app state and events**

In `assets/app.js`, replace `selectedMonths` and `selectedAccountIds` with:

```js
startMonth: getCurrentMonth(),
endMonth: getCurrentMonth(),
selectedAccountId: "all",
```

Use `getSelectedMonths()` to produce an inclusive month list between start and end, and `getSelectedAccountIds()` to return `[]` for all accounts or `[selectedAccountId]` for one account.

- [ ] **Step 3: Update rendering**

Render `#startMonthInput`, `#endMonthInput`, and `#accountFilterInput`; remove `renderMonthFilters`, `renderAccountFilters`, `updateSelectedMonths`, and `updateSelectedAccounts`.

- [ ] **Step 4: Update CSS**

Keep `.dashboard-filters`, remove unused checkbox pill styling if no longer used, and add `.account-filter-control` to match `.month-control`.

- [ ] **Step 5: Run browser test and confirm it passes**

Run the browser smoke command from Task 1.

Expected: browser smoke test passes.

---

### Task 3: Full Verification and Deploy

**Files:**
- Modify: `service-worker.js`

**Interfaces:**
- Produces: cache name `ai-caiduo-v6`

- [ ] **Step 1: Bump cache**

Change `service-worker.js` cache name to:

```js
const CACHE_NAME = "ai-caiduo-v6";
```

- [ ] **Step 2: Run full verification**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs tests\ledger-importer.test.mjs
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
git diff --check
```

Expected: all tests pass and no whitespace errors.

- [ ] **Step 3: Commit and deploy**

Run:

```powershell
git add index.html assets/app.js assets/styles.css tests/legacy-browser-smoke.test.mjs service-worker.js
git commit -m "Refine dashboard filters"
git push origin master
```

Watch the latest Pages deployment and verify online controls load.

## Self-Review

- Spec coverage: Task 2 covers range months and account dropdown; Task 1 covers regression behavior; Task 3 covers cache and deployment.
- Placeholder scan: no open placeholders or deferred implementation notes.
- Type consistency: `startMonth`, `endMonth`, `selectedAccountId`, `getSelectedMonths`, and `getSelectedAccountIds` are used consistently.
