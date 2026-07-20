# Dashboard Colors and Merchant Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align cash-flow dashboard colors with transaction row colors and add conservative merchant-category rules for the user's new statement examples.

**Architecture:** Extend the existing deterministic category rules in `assets/ledger-core.mjs`. Update only dashboard metric color CSS in `assets/styles.css`, leaving transaction row classes unchanged.

**Tech Stack:** Static HTML/CSS/JavaScript app, ES modules, Node.js built-in test runner, Playwright browser smoke tests.

## Global Constraints

- No external merchant lookup in this iteration.
- Do not guess ambiguous merchants; fallback remains `其他支出` or `其他收入`.
- Dashboard income is red and dashboard expense is green.
- Transaction row colors remain income red, expense green, transfer/refunded grey.
- Keep the change local and avoid unrelated refactors.

---

### Task 1: Merchant Recommendation Rules

**Files:**
- Modify: `assets/ledger-core.mjs`
- Test: `tests/ledger-core.test.mjs`

**Interfaces:**
- Consumes: `recommendCategory(description, typeOrOptions)`
- Produces: high-confidence recommendations for `喜家德`, `果蔬好`, and `停简单`.

- [ ] **Step 1: Write failing tests**

Add assertions to `tests/ledger-core.test.mjs`:

```js
assert.equal(recommendCategory("财付通-喜家德北京鼎成时代", "expense").category, "餐饮");
assert.equal(recommendCategory("财付通-果蔬好", "expense").category, "购物");
assert.equal(recommendCategory("财付通-停简单平台商户", "expense").category, "交通");
assert.equal(recommendCategory("平台商户", "expense").category, "其他支出");
```

- [ ] **Step 2: Verify red**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\ledger-core.test.mjs
```

Expected: fails because at least the new merchant examples fall back.

- [ ] **Step 3: Implement minimal rules**

Add the clear brand/scene tokens to existing category regexes:

```js
["餐饮", /...|喜家德|水饺|饺子/iu]
["交通", /...|停简单|停车费|停车场|车场/u]
["购物", /...|果蔬好|生鲜超市|水果店|蔬菜/u]
```

- [ ] **Step 4: Verify green**

Run the core test command again. Expected: all core tests pass.

### Task 2: Dashboard Metric Colors

**Files:**
- Modify: `assets/styles.css`
- Modify: `service-worker.js`
- Test: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: dashboard elements `#incomeTotal` and `#expenseTotal`.
- Produces: dashboard income red, dashboard expense green.

- [ ] **Step 1: Write failing browser assertions**

Add or extend a browser smoke test to inspect computed styles:

```js
assert.equal(dashboardStyles.income.color, "rgb(215, 98, 72)");
assert.equal(dashboardStyles.expense.color, "rgb(19, 101, 82)");
```

- [ ] **Step 2: Verify red**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-name-pattern "dashboard|multiple transaction" tests\legacy-browser-smoke.test.mjs
```

Expected: fails because dashboard colors still use the old income-green/expense-red mapping.

- [ ] **Step 3: Implement CSS and cache update**

Swap only `.metric-income strong` and `.metric-expense strong` colors in `assets/styles.css`, then bump `service-worker.js` from `ai-caiduo-v21` to `ai-caiduo-v22`.

- [ ] **Step 4: Verify full suite**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\ledger-core.test.mjs tests\ledger-importer.test.mjs tests\legacy-browser-smoke.test.mjs
git diff --check
```

Expected: all tests pass and diff check has no output.
