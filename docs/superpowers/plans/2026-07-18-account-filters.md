# Account Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lightweight account management, account filtering, and multi-month cash flow filtering to AI财舵.

**Architecture:** Keep the app as a static browser-local PWA. Put month/account filtering and CSV account output in pure helpers in `assets/ledger-core.mjs`, then wire browser-local account storage and UI in `assets/app.js`. Use existing localStorage persistence; old transactions without `accountId` render as `未指定账户`.

**Tech Stack:** Static HTML, CSS, browser JavaScript modules, Node.js built-in test runner, Playwright smoke test with Microsoft Edge.

## Global Constraints

- Account management is a lightweight transaction tag system only.
- No account balance calculation.
- No credit card repayment matching.
- No asset, liability, or net worth model.
- Preserve existing browser-local transaction data.
- Old transactions without an account show as `未指定账户`.
- Default local accounts are `招商信用卡`, `微信`, `支付宝`, and `现金`.
- GitHub Pages users must receive updated scripts through a service-worker cache version bump.

---

## File Structure

- `assets/ledger-core.mjs`: Pure ledger helpers. Add constants for the unassigned account, add multi-month/account filtering, add selection summary, and extend CSV export with account names.
- `tests/ledger-core.test.mjs`: Unit tests for multi-month summaries, account filtering, unassigned-account behavior, and CSV account column output.
- `index.html`: Add account selectors, dashboard month/account filter containers, account management panel, and transaction table account column.
- `assets/app.js`: Add account localStorage, account CRUD UI, account assignment for manual and imported transactions, multi-month dashboard state, account filter state, CSV account mapping, and rendering updates.
- `assets/styles.css`: Add compact checklist, account panel, account rows, and updated table/filter layout styles.
- `tests/legacy-browser-smoke.test.mjs`: Extend the browser smoke test to cover account creation, manual account assignment, multi-month selection, account filter selection, and visible rows.
- `service-worker.js`: Bump cache name from the current version to `ai-caiduo-v5`.

---

### Task 1: Core Filtering and CSV Account Output

**Files:**
- Modify: `assets/ledger-core.mjs`
- Modify: `tests/ledger-core.test.mjs`

**Interfaces:**
- Produces: `UNASSIGNED_ACCOUNT_ID: "__unassigned__"`
- Produces: `UNASSIGNED_ACCOUNT_NAME: "未指定账户"`
- Produces: `filterLedgerTransactions(transactions, filters)` where `filters` is `{ months?: string[], accountIds?: string[] }`
- Produces: `summarizeSelection(transactions, filters)` returning the same shape as `summarizeMonth`
- Changes: `toCsv(transactions, options = {})` where `options.accountNameById` maps account ids to account names
- Preserves: `summarizeMonth(transactions, monthKey)` continues to work for existing callers

- [ ] **Step 1: Write the failing tests**

Add these tests to `tests/ledger-core.test.mjs`:

```js
test("summarizes selected months across selected accounts", () => {
  const summary = summarizeSelection(
    [
      { date: "2026-07-02", amount: -32.5, category: "餐饮", accountId: "cmb" },
      { date: "2026-08-03", amount: 12000, category: "收入", accountId: "wechat" },
      { date: "2026-08-04", amount: -48.2, category: "交通", accountId: "wechat" },
      { date: "2026-09-01", amount: -100, category: "购物", accountId: "cmb" },
    ],
    { months: ["2026-07", "2026-08"], accountIds: ["wechat"] },
  );

  assert.equal(summary.income, 12000);
  assert.equal(summary.expense, 48.2);
  assert.equal(summary.balance, 11951.8);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.categoryTotals, [{ category: "交通", amount: 48.2 }]);
});

test("filters transactions by selected months and unassigned account", () => {
  const transactions = filterLedgerTransactions(
    [
      { date: "2026-07-01", amount: -10, category: "餐饮" },
      { date: "2026-07-02", amount: -20, category: "交通", accountId: "cmb" },
      { date: "2026-08-01", amount: -30, category: "购物" },
    ],
    { months: ["2026-07"], accountIds: [UNASSIGNED_ACCOUNT_ID] },
  );

  assert.deepEqual(transactions, [{ date: "2026-07-01", amount: -10, category: "餐饮" }]);
});

test("exports csv with account names", () => {
  const csv = toCsv(
    [
      {
        date: "2026-07-02",
        description: "午餐,咖啡",
        amount: -45.6,
        direction: "expense",
        category: "餐饮",
        source: "manual",
        accountId: "cmb",
      },
      {
        date: "2026-07-03",
        description: "旧数据",
        amount: -8,
        direction: "expense",
        category: "其他",
        source: "manual",
      },
    ],
    { accountNameById: { cmb: "招商信用卡" } },
  );

  assert.equal(
    csv,
    "日期,账户,类型,分类,说明,金额,来源\n2026-07-02,招商信用卡,支出,餐饮,\"午餐,咖啡\",-45.60,manual\n2026-07-03,未指定账户,支出,其他,旧数据,-8.00,manual",
  );
});
```

Update the import list in `tests/ledger-core.test.mjs` to include:

```js
  UNASSIGNED_ACCOUNT_ID,
  filterLedgerTransactions,
  summarizeSelection,
```

Update the existing `exports csv with escaped fields` expectation to include the new `账户` column and `未指定账户` value:

```js
assert.equal(
  csv,
  "日期,账户,类型,分类,说明,金额,来源\n2026-07-02,未指定账户,支出,餐饮,\"午餐,咖啡\",-45.60,manual",
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs
```

Expected: failure because `summarizeSelection`, `filterLedgerTransactions`, and `UNASSIGNED_ACCOUNT_ID` are not exported yet, and the existing CSV expectation no longer matches.

- [ ] **Step 3: Implement core helpers**

Add these exports near the top of `assets/ledger-core.mjs`:

```js
export const UNASSIGNED_ACCOUNT_ID = "__unassigned__";
export const UNASSIGNED_ACCOUNT_NAME = "未指定账户";
```

Replace `summarizeMonth` with:

```js
export function summarizeMonth(transactions, monthKey) {
  return summarizeSelection(transactions, { months: [monthKey] });
}

export function summarizeSelection(transactions, filters = {}) {
  const selectedTransactions = filterLedgerTransactions(transactions, filters);

  const income = roundMoney(
    selectedTransactions
      .filter((transaction) => Number(transaction.amount) > 0)
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0),
  );
  const expense = roundMoney(
    selectedTransactions
      .filter((transaction) => Number(transaction.amount) < 0)
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount)), 0),
  );
  const categoryMap = new Map();

  for (const transaction of selectedTransactions) {
    if (Number(transaction.amount) >= 0) {
      continue;
    }

    const category = transaction.category || "其他";
    categoryMap.set(
      category,
      roundMoney((categoryMap.get(category) || 0) + Math.abs(Number(transaction.amount))),
    );
  }

  const categoryTotals = [...categoryMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "zh-CN"));

  return {
    income,
    expense,
    balance: roundMoney(income - expense),
    count: selectedTransactions.length,
    categoryTotals,
  };
}

export function filterLedgerTransactions(transactions, filters = {}) {
  const months = new Set((filters.months || []).filter(Boolean));
  const accountIds = new Set((filters.accountIds || []).filter(Boolean));
  const shouldFilterMonths = months.size > 0;
  const shouldFilterAccounts = accountIds.size > 0;

  return transactions.filter((transaction) => {
    const date = String(transaction.date || "");
    const transactionMonth = date.slice(0, 7);
    const accountId = transaction.accountId || UNASSIGNED_ACCOUNT_ID;

    return (
      (!shouldFilterMonths || months.has(transactionMonth)) &&
      (!shouldFilterAccounts || accountIds.has(accountId))
    );
  });
}
```

Update `toCsv` to include account names:

```js
export function toCsv(transactions, options = {}) {
  const accountNameById = options.accountNameById || {};
  const rows = transactions.map((transaction) => {
    const accountId = transaction.accountId || UNASSIGNED_ACCOUNT_ID;
    const accountName = accountNameById[accountId] || UNASSIGNED_ACCOUNT_NAME;

    return [
      transaction.date,
      accountName,
      transaction.direction === "income" ? "收入" : "支出",
      transaction.category,
      transaction.description,
      Number(transaction.amount).toFixed(2),
      transaction.source || "manual",
    ];
  });

  return [["日期", "账户", "类型", "分类", "说明", "金额", "来源"], ...rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs
```

Expected: all `ledger-core` tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add assets/ledger-core.mjs tests/ledger-core.test.mjs
git commit -m "Add ledger account filters"
```

---

### Task 2: Account Storage and Management UI

**Files:**
- Modify: `index.html`
- Modify: `assets/app.js`
- Modify: `assets/styles.css`
- Modify: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `UNASSIGNED_ACCOUNT_ID` and `UNASSIGNED_ACCOUNT_NAME` from `assets/ledger-core.mjs`
- Produces in app state: `accounts`, `selectedAccountIds`, `selectedMonths`
- Produces DOM ids: `accountForm`, `accountNameInput`, `accountStatus`, `accountList`, `accountInput`, `importAccountInput`, `monthFilterList`, `accountFilterList`

- [ ] **Step 1: Write the failing browser smoke coverage for account UI**

Extend `tests/legacy-browser-smoke.test.mjs` inside the existing test after page load and before file upload:

```js
await page.fill("#accountNameInput", "储蓄卡");
await page.click("#accountForm button[type=submit]");
await page.waitForTimeout(100);

assert.ok(await page.locator("#accountList").getByText("招商信用卡").isVisible());
assert.ok(await page.locator("#accountList").getByText("储蓄卡").isVisible());
assert.equal(await page.locator("#accountInput option").filter({ hasText: "储蓄卡" }).count(), 1);
assert.equal(
  await page.locator("#importAccountInput option").filter({ hasText: "储蓄卡" }).count(),
  1,
);
```

- [ ] **Step 2: Run browser smoke to verify it fails**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: failure because `#accountNameInput`, `#accountList`, `#accountInput`, or `#importAccountInput` do not exist yet.

- [ ] **Step 3: Add account markup**

In `index.html`, add this field inside `#entryForm` after the type field:

```html
<label>
  <span>账户</span>
  <select id="accountInput" name="account"></select>
</label>
```

In `index.html`, add this block inside `.import-panel` before `.file-meta`:

```html
<label class="import-account-control">
  <span>入账账户</span>
  <select id="importAccountInput" name="importAccount"></select>
</label>
```

In `index.html`, add this section after the import panel:

```html
<section class="accounts-panel" aria-labelledby="accounts-title">
  <div class="section-heading">
    <div>
      <p class="eyebrow">账户</p>
      <h2 id="accounts-title">账户管理</h2>
    </div>
  </div>

  <form id="accountForm" class="account-form">
    <label>
      <span>账户名称</span>
      <input id="accountNameInput" name="accountName" type="text" maxlength="24" placeholder="例如：储蓄卡" />
    </label>
    <button class="primary-button" type="submit">添加</button>
  </form>

  <p id="accountStatus" class="inline-status" role="status" aria-live="polite"></p>
  <div id="accountList" class="account-list"></div>
</section>
```

- [ ] **Step 4: Add app state, storage, and render functions**

Update imports in `assets/app.js`:

```js
import {
  UNASSIGNED_ACCOUNT_ID,
  UNASSIGNED_ACCOUNT_NAME,
  filterLedgerTransactions,
  inferCategory,
  summarizeSelection,
  toCsv,
} from "./ledger-core.mjs";
```

Add account constants after `STORAGE_KEY`:

```js
const ACCOUNTS_STORAGE_KEY = "ai-caiduo-accounts-v1";
const DEFAULT_ACCOUNTS = [
  { id: "cmb-credit-card", name: "招商信用卡" },
  { id: "wechat", name: "微信" },
  { id: "alipay", name: "支付宝" },
  { id: "cash", name: "现金" },
];
```

Extend `state`:

```js
  accounts: loadAccounts(),
  selectedMonths: [getCurrentMonth()],
  selectedAccountIds: [],
```

Extend `elements`:

```js
  accountInput: document.querySelector("#accountInput"),
  importAccountInput: document.querySelector("#importAccountInput"),
  monthFilterList: document.querySelector("#monthFilterList"),
  accountFilterList: document.querySelector("#accountFilterList"),
  accountForm: document.querySelector("#accountForm"),
  accountNameInput: document.querySelector("#accountNameInput"),
  accountStatus: document.querySelector("#accountStatus"),
  accountList: document.querySelector("#accountList"),
```

Add these account helpers:

```js
function loadAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_ACCOUNTS.map((account) => ({
        ...account,
        createdAt: new Date().toISOString(),
      }));
    }
    const parsed = JSON.parse(raw);
    const accounts = Array.isArray(parsed) ? parsed.filter(isValidAccount) : [];
    return accounts.length > 0 ? accounts : [];
  } catch {
    return DEFAULT_ACCOUNTS.map((account) => ({
      ...account,
      createdAt: new Date().toISOString(),
    }));
  }
}

function isValidAccount(account) {
  return Boolean(account && account.id && String(account.name || "").trim());
}

function persistAccounts() {
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(state.accounts));
}

function getAccountName(accountId) {
  return state.accounts.find((account) => account.id === accountId)?.name || UNASSIGNED_ACCOUNT_NAME;
}

function getAccountNameById() {
  return Object.fromEntries(state.accounts.map((account) => [account.id, account.name]));
}
```

Add account rendering:

```js
function renderAccountOptions() {
  const options = [
    createOption(UNASSIGNED_ACCOUNT_ID, UNASSIGNED_ACCOUNT_NAME),
    ...state.accounts.map((account) => createOption(account.id, account.name)),
  ];

  replaceChildrenCompat(elements.accountInput, ...options.map((option) => option.cloneNode(true)));
  replaceChildrenCompat(
    elements.importAccountInput,
    ...options.map((option) => option.cloneNode(true)),
  );

  if (state.accounts.some((account) => account.id === "cmb-credit-card")) {
    elements.accountInput.value = elements.accountInput.value || "cmb-credit-card";
    elements.importAccountInput.value = elements.importAccountInput.value || "cmb-credit-card";
  }
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function renderAccountList() {
  replaceChildrenCompat(
    elements.accountList,
    ...state.accounts.map((account) => {
      const row = document.createElement("div");
      row.className = "account-row";
      row.innerHTML = `
        <input data-account-name-id="${escapeHtml(account.id)}" value="${escapeHtml(account.name)}" aria-label="账户名称" />
        <button class="delete-button" type="button" data-delete-account-id="${escapeHtml(account.id)}">删除</button>
      `;
      return row;
    }),
  );
}
```

Add account event handlers:

```js
elements.accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addAccount();
});

elements.accountList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-account-name-id]");
  if (input) {
    renameAccount(input.dataset.accountNameId, input.value);
  }
});

elements.accountList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-account-id]");
  if (button) {
    deleteAccount(button.dataset.deleteAccountId);
  }
});
```

Add account mutations:

```js
function addAccount() {
  const name = elements.accountNameInput.value.trim();
  if (!name) {
    setAccountStatus("请输入账户名称");
    return;
  }
  if (state.accounts.some((account) => account.name === name)) {
    setAccountStatus("账户名称已存在");
    return;
  }

  state.accounts = [...state.accounts, { id: createId(), name, createdAt: new Date().toISOString() }];
  elements.accountNameInput.value = "";
  persistAccounts();
  setAccountStatus(`已添加 ${name}`);
  render();
}

function renameAccount(id, nextName) {
  const name = nextName.trim();
  if (!name) {
    setAccountStatus("账户名称不能为空");
    renderAccountList();
    return;
  }
  if (state.accounts.some((account) => account.id !== id && account.name === name)) {
    setAccountStatus("账户名称已存在");
    renderAccountList();
    return;
  }

  state.accounts = state.accounts.map((account) =>
    account.id === id ? { ...account, name } : account,
  );
  persistAccounts();
  setAccountStatus(`已更新 ${name}`);
  render();
}

function deleteAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  state.accounts = state.accounts.filter((item) => item.id !== id);
  state.selectedAccountIds = state.selectedAccountIds.filter((accountId) => accountId !== id);
  persistAccounts();
  setAccountStatus(account ? `已删除 ${account.name}` : "");
  render();
}

function setAccountStatus(message) {
  elements.accountStatus.textContent = message;
}
```

Call `renderAccountOptions()` before `bindEvents()` in `init()`, and call `renderAccountOptions()` and `renderAccountList()` from `render()`.

- [ ] **Step 5: Add CSS for account UI**

Add to `assets/styles.css`:

```css
.accounts-panel {
  grid-column: 2;
  padding: 22px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.account-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
}

.inline-status {
  min-height: 20px;
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}

.account-list {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}

.account-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.import-account-control {
  margin-top: 12px;
}
```

In the `@media (max-width: 920px)` block, add `.accounts-panel` to the single-column rule:

```css
  .accounts-panel {
    grid-column: 1;
  }
```

In the `@media (max-width: 640px)` block, add:

```css
  .account-form,
  .account-row {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 6: Run browser smoke to verify it passes**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: browser smoke test passes.

- [ ] **Step 7: Commit**

Run:

```powershell
git add index.html assets/app.js assets/styles.css tests/legacy-browser-smoke.test.mjs
git commit -m "Add local account management"
```

---

### Task 3: Multi-Month and Account Filtering in the Dashboard

**Files:**
- Modify: `index.html`
- Modify: `assets/app.js`
- Modify: `assets/styles.css`
- Modify: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `filterLedgerTransactions`, `summarizeSelection`, `UNASSIGNED_ACCOUNT_ID`, `UNASSIGNED_ACCOUNT_NAME`
- Produces: dashboard month checkboxes such as `data-month-filter="2026-07"`
- Produces: dashboard account checkboxes such as `data-account-filter-id="wechat"`
- Produces: transaction table account column using `getAccountName(transaction.accountId)`

- [ ] **Step 1: Write failing browser smoke coverage for multi-month/account filters**

Replace the single file-upload-only body in `tests/legacy-browser-smoke.test.mjs` with a flow that first adds two manual transactions:

```js
await page.selectOption("#accountInput", "cmb-credit-card");
await page.fill("#dateInput", "2026-07-02");
await page.selectOption("#directionInput", "expense");
await page.fill("#amountInput", "32.50");
await page.fill("#descriptionInput", "星巴克咖啡");
await page.click("#entryForm button[type=submit]");

await page.selectOption("#accountInput", "wechat");
await page.fill("#dateInput", "2026-08-03");
await page.selectOption("#directionInput", "income");
await page.fill("#amountInput", "12000");
await page.fill("#descriptionInput", "工资入账");
await page.click("#entryForm button[type=submit]");

await page.check('[data-month-filter="2026-08"]');
assert.equal(await page.locator("#transactionRows tr").count(), 2);
assert.equal(await page.locator("#transactionCount").textContent(), "2");

await page.check('[data-account-filter-id="wechat"]');
assert.equal(await page.locator("#transactionRows tr").count(), 1);
assert.ok(await page.locator("#transactionRows").getByText("微信").isVisible());
assert.equal(await page.locator("#transactionCount").textContent(), "1");
```

Keep the existing import preview assertions later in the test, but update expected row counts by clearing localStorage at the beginning and using independent assertions for pending rows.

- [ ] **Step 2: Run browser smoke to verify it fails**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: failure because month/account filter checkboxes and transaction account table output are not implemented yet.

- [ ] **Step 3: Add dashboard filter markup**

In `index.html`, replace the current `label.month-control` in the overview heading with:

```html
<label class="month-control">
  <span>添加月份</span>
  <input id="monthInput" type="month" />
</label>
```

Add this block in `.overview-panel` after `.panel-heading` and before `.metric-grid`:

```html
<div class="dashboard-filters" aria-label="看板筛选">
  <fieldset class="filter-group">
    <legend>月份</legend>
    <div id="monthFilterList" class="checklist" aria-label="筛选月份"></div>
  </fieldset>
  <fieldset class="filter-group">
    <legend>账户</legend>
    <div id="accountFilterList" class="checklist" aria-label="筛选账户"></div>
  </fieldset>
</div>
```

In the transaction table header, add:

```html
<th>账户</th>
```

Place the new account header between `日期` and `说明`.

- [ ] **Step 4: Implement filter rendering and events**

In `bindEvents()`, update month handling:

```js
elements.monthInput.addEventListener("change", () => {
  const month = elements.monthInput.value || getCurrentMonth();
  if (!state.selectedMonths.includes(month)) {
    state.selectedMonths = [...state.selectedMonths, month].sort();
  }
  render();
});

elements.monthFilterList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-month-filter]");
  if (!input) {
    return;
  }
  updateSelectedMonths(input.dataset.monthFilter, input.checked);
});

elements.accountFilterList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-account-filter-id]");
  if (!input) {
    return;
  }
  updateSelectedAccounts(input.dataset.accountFilterId, input.checked);
});
```

Add filter helpers:

```js
function updateSelectedMonths(month, isSelected) {
  state.selectedMonths = isSelected
    ? [...new Set([...state.selectedMonths, month])].sort()
    : state.selectedMonths.filter((selectedMonth) => selectedMonth !== month);

  if (state.selectedMonths.length === 0) {
    state.selectedMonths = [getCurrentMonth()];
  }
  render();
}

function updateSelectedAccounts(accountId, isSelected) {
  if (accountId === "all") {
    state.selectedAccountIds = [];
    render();
    return;
  }

  state.selectedAccountIds = isSelected
    ? [...new Set([...state.selectedAccountIds, accountId])]
    : state.selectedAccountIds.filter((selectedId) => selectedId !== accountId);
  render();
}

function getAvailableMonths() {
  return [
    ...new Set([
      getCurrentMonth(),
      ...state.selectedMonths,
      ...state.transactions.map((transaction) => String(transaction.date || "").slice(0, 7)),
    ]),
  ]
    .filter((month) => /^\d{4}-\d{2}$/u.test(month))
    .sort();
}

function getVisibleAccountIds() {
  return [UNASSIGNED_ACCOUNT_ID, ...state.accounts.map((account) => account.id)];
}
```

Add render functions:

```js
function renderMonthFilters() {
  const months = getAvailableMonths();
  replaceChildrenCompat(
    elements.monthFilterList,
    ...months.map((month) => {
      const label = document.createElement("label");
      label.className = "check-pill";
      label.innerHTML = `
        <input type="checkbox" data-month-filter="${escapeHtml(month)}" ${
          state.selectedMonths.includes(month) ? "checked" : ""
        } />
        <span>${escapeHtml(month)}</span>
      `;
      return label;
    }),
  );
}

function renderAccountFilters() {
  const allLabel = document.createElement("label");
  allLabel.className = "check-pill";
  allLabel.innerHTML = `
    <input type="checkbox" data-account-filter-id="all" ${
      state.selectedAccountIds.length === 0 ? "checked" : ""
    } />
    <span>全部账户</span>
  `;

  const accountLabels = getVisibleAccountIds().map((accountId) => {
    const label = document.createElement("label");
    label.className = "check-pill";
    label.innerHTML = `
      <input type="checkbox" data-account-filter-id="${escapeHtml(accountId)}" ${
        state.selectedAccountIds.includes(accountId) ? "checked" : ""
      } />
      <span>${escapeHtml(getAccountName(accountId))}</span>
    `;
    return label;
  });

  replaceChildrenCompat(elements.accountFilterList, allLabel, ...accountLabels);
}
```

Call `renderMonthFilters()` and `renderAccountFilters()` from `render()`.

- [ ] **Step 5: Wire summaries, visible rows, and CSV through filters**

Replace `renderSummary()` summary creation:

```js
const summary = summarizeSelection(state.transactions, {
  months: state.selectedMonths,
  accountIds: state.selectedAccountIds,
});
```

Replace category filter month filtering with selected-month/account filtering:

```js
const categories = [
  "all",
  ...new Set(
    filterLedgerTransactions(state.transactions, {
      months: state.selectedMonths,
      accountIds: state.selectedAccountIds,
    }).map((transaction) => transaction.category),
  ),
];
```

Replace `getVisibleTransactions()` filtering:

```js
return filterLedgerTransactions(state.transactions, {
  months: state.selectedMonths,
  accountIds: state.selectedAccountIds,
})
  .filter(
    (transaction) =>
      state.categoryFilter === "all" || transaction.category === state.categoryFilter,
  )
  .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
```

Update `exportTransactions()`:

```js
const csv = toCsv(transactions, { accountNameById: getAccountNameById() });
const monthSuffix =
  state.selectedMonths.length === 1 ? state.selectedMonths[0] : state.selectedMonths.join("_");
link.download = `AI财舵-${monthSuffix}.csv`;
```

Update `createTransactionRow()` to include account:

```js
    <td data-label="账户">${escapeHtml(getAccountName(transaction.accountId))}</td>
```

Place it after the date cell.

- [ ] **Step 6: Add dashboard filter CSS**

Add to `assets/styles.css`:

```css
.dashboard-filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.filter-group {
  margin: 0;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fbfcfa;
}

.filter-group legend {
  padding: 0 4px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.checklist {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.check-pill {
  display: inline-flex;
  width: auto;
  min-height: 34px;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 10px;
  background: #ffffff;
  color: var(--ink);
  font-size: 13px;
}

.check-pill input {
  width: 16px;
  min-height: 16px;
  margin: 0;
}
```

In the `@media (max-width: 640px)` block, add:

```css
  .dashboard-filters {
    grid-template-columns: 1fr;
  }
```

- [ ] **Step 7: Run browser smoke to verify it passes**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: browser smoke test passes.

- [ ] **Step 8: Commit**

Run:

```powershell
git add index.html assets/app.js assets/styles.css tests/legacy-browser-smoke.test.mjs
git commit -m "Add dashboard account and month filters"
```

---

### Task 4: Account Assignment for Manual and Imported Transactions

**Files:**
- Modify: `assets/app.js`
- Modify: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `accountInput` and `importAccountInput`
- Produces: manual transactions with optional `accountId`
- Produces: imported transactions assigned to the selected import account on confirmation

- [ ] **Step 1: Write failing browser smoke coverage for import account assignment**

After the existing import preview and confirmation flow in `tests/legacy-browser-smoke.test.mjs`, add:

```js
await page.selectOption("#importAccountInput", "alipay");
await page.setInputFiles("#fileInput", {
  name: "alipay-statement.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(`2026-07-05 支付宝-高德打车 -10.30`),
});
await page.click("#importButton");
await page.waitForTimeout(300);
assert.equal(await page.locator("#pendingRows tr").count(), 1);
await page.click("#confirmImportButton");
await page.waitForTimeout(300);

await page.check('[data-account-filter-id="alipay"]');
assert.ok(await page.locator("#transactionRows").getByText("支付宝").isVisible());
assert.ok(await page.locator("#transactionRows").getByText("高德打车").isVisible());
```

- [ ] **Step 2: Run browser smoke to verify it fails**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: failure because imported transactions are not assigned to `importAccountInput` yet.

- [ ] **Step 3: Implement account assignment**

Add helper:

```js
function normalizeAccountId(accountId) {
  return accountId && accountId !== UNASSIGNED_ACCOUNT_ID ? accountId : undefined;
}
```

Update `addManualTransaction()` transaction creation:

```js
const transaction = withId({
  date: elements.dateInput.value,
  description,
  amount: direction === "expense" ? -amount : amount,
  direction,
  category,
  accountId: normalizeAccountId(elements.accountInput.value),
  source: "manual",
});
```

Update `confirmPendingImport()`:

```js
const importAccountId = normalizeAccountId(elements.importAccountInput.value);
const imported = state.pendingTransactions.map(({ previewId, ...transaction }) =>
  withId({ ...transaction, accountId: importAccountId }),
);
```

After manual form reset, restore account selection:

```js
elements.accountInput.value = "cmb-credit-card";
```

- [ ] **Step 4: Run browser smoke to verify it passes**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: browser smoke test passes.

- [ ] **Step 5: Commit**

Run:

```powershell
git add assets/app.js tests/legacy-browser-smoke.test.mjs
git commit -m "Assign accounts to ledger entries"
```

---

### Task 5: Cache, Full Verification, and Deployment

**Files:**
- Modify: `service-worker.js`

**Interfaces:**
- Consumes: completed account/filter implementation from Tasks 1-4
- Produces: deployable static PWA with cache name `ai-caiduo-v5`

- [ ] **Step 1: Update service-worker cache**

Change the first line of `service-worker.js`:

```js
const CACHE_NAME = "ai-caiduo-v5";
```

- [ ] **Step 2: Run full unit and browser verification**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs tests\ledger-importer.test.mjs
```

Expected: all unit tests pass.

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: browser smoke test passes.

Run:

```powershell
git diff --check
```

Expected: no whitespace errors. Windows line-ending warnings are acceptable in this repository.

- [ ] **Step 3: Commit**

Run:

```powershell
git add service-worker.js
git commit -m "Refresh app cache for account filters"
```

- [ ] **Step 4: Push and verify GitHub Pages deployment**

Run:

```powershell
git push origin master
gh run list --repo RRROT507/ai-caiduo-pages --limit 3
$run = gh run list --repo RRROT507/ai-caiduo-pages --limit 1 --json databaseId --jq ".[0].databaseId"
gh run watch $run --repo RRROT507/ai-caiduo-pages --exit-status
```

Expected: latest `pages-build-deployment` completes with `success`.

- [ ] **Step 5: Verify online assets**

Run:

```powershell
$commit = git rev-parse --short HEAD
$app = Invoke-WebRequest -UseBasicParsing "https://rrrot507.github.io/ai-caiduo-pages/assets/app.js?v=$commit"
$sw = Invoke-WebRequest -UseBasicParsing "https://rrrot507.github.io/ai-caiduo-pages/service-worker.js?v=$commit"
[pscustomobject]@{
  AppStatus = $app.StatusCode
  HasAccountInput = $app.Content.Contains("accountInput")
  HasSelectionSummary = $app.Content.Contains("summarizeSelection")
  ServiceWorkerStatus = $sw.StatusCode
  HasCacheV5 = $sw.Content.Contains("ai-caiduo-v5")
}
```

Expected: all status values are `200`; all boolean values are `True`.

- [ ] **Step 6: Run online browser smoke for the new controls**

Use a Playwright script against the cache-busted URL built from the current commit:

```powershell
$commit = git rev-parse --short HEAD
$url = "https://rrrot507.github.io/ai-caiduo-pages/?v=$commit"
```

Expected browser facts:

- `#accountNameInput` exists.
- `#accountInput` contains `招商信用卡`, `微信`, `支付宝`, and `现金`.
- Adding a manual July transaction to `招商信用卡` creates one visible row.
- Adding a manual August transaction to `微信`, then checking `2026-08`, shows two visible rows.
- Checking the `微信` account filter shows one visible row.
- No page errors are emitted.

## Self-Review

- Spec coverage: account management is covered by Task 2; manual/import account assignment by Task 4; account and multi-month dashboard filtering by Task 3; CSV account output and unassigned behavior by Task 1; service-worker deployment by Task 5.
- Placeholder scan: the plan uses exact paths, function names, commands, expected outcomes, and concrete code snippets. No open placeholders remain.
- Type consistency: `accountId`, `selectedAccountIds`, `selectedMonths`, `UNASSIGNED_ACCOUNT_ID`, `filterLedgerTransactions`, and `summarizeSelection` are used consistently across tasks.
