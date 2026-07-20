# Refunded Transactions and Merchant Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add conservative dining merchant recommendations, automatic same-account refund tagging, and the requested transaction color semantics.

**Architecture:** Extend `assets/ledger-core.mjs` with `refunded` type support and a strict refund-pair tagging pass after transfer detection. Keep UI rendering in `assets/app.js` type-driven, and update `assets/styles.css` color tokens/classes without changing layout.

**Tech Stack:** Static HTML/CSS/JavaScript app, ES modules, Node.js built-in test runner, Playwright browser smoke tests.

## Global Constraints

- Do not add external merchant lookup in this iteration.
- Do not guess ambiguous merchants; fallback remains `其他支出` or `其他收入`.
- Refunded transactions remain visible but do not affect income, expense, balance, or category totals.
- Expense rows are green; income rows are red; transfer and refunded rows are grey.
- Preserve existing localStorage data shape as much as possible; normalize legacy rows at load/render time.

---

### Task 1: Merchant Recommendation Rules

**Files:**
- Modify: `assets/ledger-core.mjs`
- Test: `tests/ledger-core.test.mjs`
- Test: `tests/ledger-importer.test.mjs`

**Interfaces:**
- Consumes: `recommendCategory(description, typeOrOptions)`
- Produces: high-confidence `餐饮` recommendations for clear dining brands including `PIZZAHUT`.

- [ ] **Step 1: Write failing tests**

Add assertions in `tests/ledger-core.test.mjs`:

```js
assert.deepEqual(recommendCategory("财付通-PIZZAHUT", "expense"), {
  category: "餐饮",
  confidence: "high",
  source: "rule",
  merchant: "PIZZAHUT",
});
assert.equal(recommendCategory("KFC", "expense").category, "餐饮");
assert.equal(recommendCategory("麦当劳", "expense").category, "餐饮");
```

- [ ] **Step 2: Verify red**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\ledger-core.test.mjs
```

Expected: fails because `PIZZAHUT` is still `其他支出`.

- [ ] **Step 3: Implement minimal rules**

Extend the dining regex in `assets/ledger-core.mjs` with explicit brand tokens such as `PIZZAHUT|必胜客|KFC|肯德基|麦当劳|星巴克|瑞幸|喜茶|奈雪|海底捞|蜜雪冰城|华莱士|汉堡王`.

- [ ] **Step 4: Verify green**

Run the same core test command. Expected: pass.

### Task 2: Refunded Type and Cash-Flow Exclusion

**Files:**
- Modify: `assets/ledger-core.mjs`
- Test: `tests/ledger-core.test.mjs`

**Interfaces:**
- Produces: `tagRefundedTransactions(transactions)` as an internal helper used by `tagTransferTransactions(transactions)`.
- Produces: `getTransactionTypes()` includes `{ value: "refunded", label: "已退款" }`.
- Produces: `getCategoriesForType("refunded")` returns `["已退款"]`.

- [ ] **Step 1: Write failing tests**

Add a core test with two same-account opposite-sign `财付通-虎头军煎饼（鼎成中心店）` rows for `2026-03-02` at `+14` and `-14`, then assert both normalized rows have `type: "refunded"`, `category: "已退款"`, and summary totals remain zero.

- [ ] **Step 2: Verify red**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\ledger-core.test.mjs
```

Expected: fails because refund rows are not tagged and still affect summary.

- [ ] **Step 3: Implement refund tagging**

Add `REFUNDED_CATEGORIES`, include `refunded` in transaction type normalization, normalize refunded category to `已退款`, and add a strict same-date/same-account/same-cleaned-description/opposite-sign/equal-amount pairing pass after transfer matching.

- [ ] **Step 4: Verify green**

Run the core tests. Expected: pass.

### Task 3: UI Labels, Styles, and Browser Smoke

**Files:**
- Modify: `assets/app.js`
- Modify: `assets/styles.css`
- Modify: `service-worker.js`
- Test: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `getTransactionType(transaction)` returning `expense`, `income`, `transfer`, or `refunded`.
- Produces: row classes where expense uses green CSS, income uses red CSS, refunded uses grey CSS.

- [ ] **Step 1: Write failing browser assertions**

Update the color smoke test to expect income category/type/amount red and expense category/type/amount green. Add a refunded pair fixture and assert two `.type-tag.refunded-tag`, two `.amount-cell.refunded-text`, and text `已退款`.

- [ ] **Step 2: Verify red**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\legacy-browser-smoke.test.mjs
```

Expected: fails on old red/green color expectations and missing refunded classes.

- [ ] **Step 3: Implement UI changes**

Update `createTransactionRow` and `createPendingRow` to select `refunded-text` / `refunded-tag`, swap income and expense CSS color definitions, add refunded CSS definitions using the grey transfer palette, and bump `service-worker.js` cache name.

- [ ] **Step 4: Verify full suite**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\ledger-core.test.mjs tests\ledger-importer.test.mjs tests\legacy-browser-smoke.test.mjs
git diff --check
```

Expected: all tests pass and diff check has no output.
