# Account Balances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opening balances to accounts and show the real running account balance after each transaction.

**Architecture:** Keep balances derived instead of storing them on transactions. `ledger-core.mjs` owns chronological running-balance calculation, while `app.js` owns account-form state, localStorage normalization, and table rendering.

**Tech Stack:** Static HTML/CSS/JavaScript modules, browser `localStorage`, Node test runner, Playwright browser smoke tests.

## Global Constraints

- The row balance is calculated from each account's opening balance plus all historical transactions for that account through the row transaction.
- Dashboard month and account filters only affect visibility; they never change a row balance.
- Accounts without `openingBalance` default to `0`.
- Existing transaction data remains unchanged.
- No new runtime dependency is needed.

---

## File Structure

- `assets/ledger-core.mjs`: add `calculateRunningBalances(transactions, options)` and keep money rounding centralized.
- `assets/app.js`: add opening-balance state handling, account storage normalization, balance lookup helpers, and transaction-row balance rendering.
- `index.html`: add opening-balance inputs and the transaction-table balance header.
- `assets/styles.css`: update account form/list grid sizing for the new input and current-balance label.
- `tests/ledger-core.test.mjs`: add unit tests for running balances.
- `tests/legacy-browser-smoke.test.mjs`: extend smoke coverage for opening balance UI and row balance updates.
- `service-worker.js`: bump cache version so GitHub Pages clients fetch the new app shell.

---

### Task 1: Add Core Running Balance Calculation

**Files:**
- Modify: `assets/ledger-core.mjs`
- Test: `tests/ledger-core.test.mjs`

**Interfaces:**
- Produces: `calculateRunningBalances(transactions, { openingBalanceByAccountId }) -> { transactionBalances: Map<string, number>, accountBalances: Map<string, number> }`
- Consumes: `UNASSIGNED_ACCOUNT_ID`, `roundMoney(value)`

- [ ] **Step 1: Write failing tests**

Add `calculateRunningBalances` to the import list in `tests/ledger-core.test.mjs`, then add:

```js
test("calculates running balances by account from opening balances", () => {
  const result = calculateRunningBalances(
    [
      { id: "later", date: "2026-07-03", createdAt: "2026-07-03T09:00:00Z", amount: 50, accountId: "cmb" },
      { id: "first", date: "2026-07-01", createdAt: "2026-07-01T09:00:00Z", amount: -20, accountId: "cmb" },
      { id: "wechat", date: "2026-07-02", createdAt: "2026-07-02T09:00:00Z", amount: -5, accountId: "wechat" },
    ],
    { openingBalanceByAccountId: { cmb: 100, wechat: 20 } },
  );

  assert.deepEqual(Object.fromEntries(result.transactionBalances), {
    first: 80,
    wechat: 15,
    later: 130,
  });
  assert.deepEqual(Object.fromEntries(result.accountBalances), {
    cmb: 130,
    wechat: 15,
  });
});

test("running balances include hidden earlier transactions", () => {
  const result = calculateRunningBalances(
    [
      { id: "hidden-june", date: "2026-06-30", amount: 100, accountId: "cmb" },
      { id: "visible-july", date: "2026-07-01", amount: -30, accountId: "cmb" },
    ],
    { openingBalanceByAccountId: { cmb: 10 } },
  );

  assert.equal(result.transactionBalances.get("visible-july"), 80);
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs
```

Expected: fails because `calculateRunningBalances` is not exported.

- [ ] **Step 3: Implement minimal core function**

Add the exported function after `filterLedgerTransactions` in `assets/ledger-core.mjs`:

```js
export function calculateRunningBalances(transactions, options = {}) {
  const openingBalanceByAccountId = options.openingBalanceByAccountId || {};
  const accountBalances = new Map(
    Object.entries(openingBalanceByAccountId).map(([accountId, amount]) => [
      accountId,
      roundMoney(toFiniteMoney(amount)),
    ]),
  );
  const transactionBalances = new Map();

  const orderedTransactions = transactions
    .map((transaction, index) => ({
      transaction,
      index,
      accountId: transaction.accountId || UNASSIGNED_ACCOUNT_ID,
      amount: Number(transaction.amount),
    }))
    .filter((item) => Number.isFinite(item.amount))
    .sort(compareTransactionsAscending);

  for (const item of orderedTransactions) {
    const previousBalance = accountBalances.get(item.accountId) || 0;
    const nextBalance = roundMoney(previousBalance + item.amount);
    accountBalances.set(item.accountId, nextBalance);

    if (item.transaction.id) {
      transactionBalances.set(item.transaction.id, nextBalance);
    }
  }

  return { transactionBalances, accountBalances };
}
```

Add helper functions near the other private helpers:

```js
function compareTransactionsAscending(a, b) {
  return (
    String(a.transaction.date || "").localeCompare(String(b.transaction.date || "")) ||
    String(a.transaction.createdAt || "").localeCompare(String(b.transaction.createdAt || "")) ||
    a.index - b.index
  );
}

function toFiniteMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}
```

- [ ] **Step 4: Verify tests pass**

Run the same Node test command. Expected: all `ledger-core` tests pass.

- [ ] **Step 5: Commit**

Commit message:

```text
Add running account balance calculation
```

---

### Task 2: Add Opening Balance Account UI and Storage

**Files:**
- Modify: `index.html`
- Modify: `assets/app.js`
- Modify: `assets/styles.css`
- Test: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `calculateRunningBalances(transactions, { openingBalanceByAccountId })`
- Produces: normalized account objects `{ id, name, openingBalance, createdAt }`
- Produces app helpers: `getAccountOpeningBalanceById()`, `getAccountBalanceById()`, `updateAccountOpeningBalance(id, value)`

- [ ] **Step 1: Write failing browser smoke assertions**

In `tests/legacy-browser-smoke.test.mjs`, after adding the custom account, fill `#accountOpeningBalanceInput` with `1000`, assert the account list has the opening balance input, then add a transaction and assert a balance cell shows `¥967.50` after a `-32.50` transaction.

- [ ] **Step 2: Verify browser smoke fails**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: fails because the opening-balance input and balance cell do not exist yet.

- [ ] **Step 3: Update HTML**

In `index.html`, add an opening-balance number input to `#accountForm` and add `账户余额` to the transaction table header after `金额`.

- [ ] **Step 4: Update app state and storage**

In `assets/app.js`:

- Import `calculateRunningBalances`.
- Add `accountOpeningBalanceInput` to `elements`.
- Add `openingBalance: 0` to each default account.
- When adding accounts, save `openingBalance: parseMoneyInput(elements.accountOpeningBalanceInput.value)`.
- Normalize loaded accounts so old data gets `openingBalance: 0`.
- Listen for `[data-account-opening-id]` changes and update the account.

- [ ] **Step 5: Update account list rendering**

Render each account row with:

- account name input
- opening-balance number input
- current balance label from `calculateRunningBalances`
- delete button

- [ ] **Step 6: Update CSS**

Set `.account-form` and `.account-row` to accommodate the new columns on desktop and keep the existing single-column mobile layout.

- [ ] **Step 7: Verify browser smoke passes**

Run the browser smoke command again. Expected: pass.

- [ ] **Step 8: Commit**

Commit message:

```text
Add account opening balances
```

---

### Task 3: Show Running Balances in Transaction Rows and Refresh Cache

**Files:**
- Modify: `assets/app.js`
- Modify: `index.html`
- Modify: `service-worker.js`
- Test: `tests/ledger-core.test.mjs`
- Test: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `calculateRunningBalances`
- Produces: transaction row balance display that uses full account history, independent of active filters.

- [ ] **Step 1: Add transaction row balance lookup**

In `assets/app.js`, calculate balances from `state.transactions`, not `getVisibleTransactions()`, and pass each visible row's balance into `createTransactionRow(transaction, accountBalance)`.

- [ ] **Step 2: Render the balance column**

Add a `<td data-label="账户余额">` to each transaction row. If a saved row has no balance key, show `¥0.00` instead of leaving a blank cell.

- [ ] **Step 3: Bump service worker cache**

Change the cache name in `service-worker.js` from the current version to the next version.

- [ ] **Step 4: Run full verification**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs tests\ledger-importer.test.mjs
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Commit message:

```text
Show running account balances
```

---

## Self-Review Notes

- Spec coverage: opening balances, real row balances, filtered visibility, old-account defaulting, invalid-input fallback, and unassigned-account behavior are covered.
- Placeholder scan: no placeholder work remains in this plan.
- Type consistency: the only new shared interface is `calculateRunningBalances(transactions, { openingBalanceByAccountId })`.
