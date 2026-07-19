# Category Recommendation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce fallback `其他支出` classifications with local, explainable, confidence-aware recommendations.

**Architecture:** Add a focused recommendation pipeline in `assets/ledger-core.mjs`, preserving `inferCategory()` as a compatibility wrapper. Feed learned merchant history from saved transactions in `assets/app.js`, and keep importer normalization conservative.

**Tech Stack:** Static HTML/CSS/JavaScript modules, Node `node:test`, Playwright smoke tests.

## Global Constraints

- Do not add live merchant lookup or third-party API calls in this step.
- Do not output categories outside the existing type-specific category lists.
- Low confidence must fall back to `其他支出` or `其他收入`; do not force a guess.
- Preserve existing import, transfer, filtering, and balance behavior.

---

### Task 1: Core Recommendation Pipeline

**Files:**
- Modify: `assets/ledger-core.mjs`
- Test: `tests/ledger-core.test.mjs`

**Interfaces:**
- Produces: `recommendCategory(description, typeOrOptions)` returning `{ category, confidence, source, merchant }`.
- Preserves: `inferCategory(description, direction)` returning a category string.

- [ ] **Step 1: Write failing core tests**

Add tests for:

```js
assert.deepEqual(recommendCategory("财付通-虎头军煎饼（鼎成中心店）", "expense"), {
  category: "餐饮",
  confidence: "high",
  source: "rule",
  merchant: "虎头军煎饼",
});
assert.deepEqual(recommendCategory("支付宝-未知商户服务", "expense").category, "其他支出");
assert.deepEqual(recommendCategory("朝朝宝转出", "income").category, "利息");
```

- [ ] **Step 2: Run failing tests**

Run: `node --test tests\ledger-core.test.mjs`

Expected: fail because `recommendCategory` is not exported.

- [ ] **Step 3: Implement recommendation pipeline**

Add merchant cleanup, confidence/source metadata, stricter rule matching, and keep `inferCategory()` as `recommendCategory(...).category`.

- [ ] **Step 4: Run core tests**

Run: `node --test tests\ledger-core.test.mjs`

Expected: pass.

### Task 2: User History Learning

**Files:**
- Modify: `assets/ledger-core.mjs`
- Modify: `assets/app.js`
- Test: `tests/ledger-core.test.mjs`
- Test: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Produces: `buildMerchantCategoryHistory(transactions)` returning a merchant-keyed map/object usable by `recommendCategory`.
- Consumes: saved `state.transactions` in quick-entry recommendation.

- [ ] **Step 1: Write failing tests**

Core test:

```js
const history = buildMerchantCategoryHistory([
  { description: "美团-常去面馆", direction: "expense", category: "餐饮" },
  { description: "常去面馆", direction: "expense", category: "餐饮" },
]);
assert.equal(
  recommendCategory("微信支付-常去面馆", { type: "expense", history }).category,
  "餐饮",
);
```

Browser test: seed saved transactions, type the same merchant in quick entry, and assert the category select changes to the learned category.

- [ ] **Step 2: Run failing tests**

Run: `node --test tests\ledger-core.test.mjs tests\legacy-browser-smoke.test.mjs`

Expected: fail because history learning is not implemented.

- [ ] **Step 3: Implement learning**

Derive merchant history from non-transfer saved transactions, ignore fallback categories, and use it when quick entry description changes.

- [ ] **Step 4: Run affected tests**

Run: `node --test tests\ledger-core.test.mjs tests\legacy-browser-smoke.test.mjs`

Expected: pass.

### Task 3: Import Integration And Release

**Files:**
- Modify: `assets/ledger-importer.mjs`
- Modify: `service-worker.js`
- Test: `tests/ledger-importer.test.mjs`

**Interfaces:**
- Consumes: `recommendCategory()` through existing `inferCategory()` or direct use where metadata helps.

- [ ] **Step 1: Update importer tests**

Add/adjust statement parsing expectations so payment-channel descriptions like `财付通-虎头军煎饼（鼎成中心店）` classify as `餐饮`, while ambiguous descriptions remain `其他支出`.

- [ ] **Step 2: Implement importer wiring**

Use the core recommendation pipeline for local parser categories. Do not send merchant descriptions to external services.

- [ ] **Step 3: Bump cache version**

Change `service-worker.js` cache name from the current version to the next version.

- [ ] **Step 4: Run full verification**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\ledger-core.test.mjs tests\ledger-importer.test.mjs tests\legacy-browser-smoke.test.mjs
git diff --check
```

Expected: all tests pass and diff check is clean.
