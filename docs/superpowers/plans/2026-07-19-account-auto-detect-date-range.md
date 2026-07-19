# Account Auto-Detection And Date Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically assign imported statement transactions to the detected bank account and replace month-only dashboard filtering with a single day-level date-range picker.

**Architecture:** Keep parsing and ledger math in `assets/ledger-importer.mjs` and `assets/ledger-core.mjs`, then wire the new data into `assets/app.js`. Account detection remains a local metadata layer on top of statement parsing; date filtering moves to `startDate` and `endDate` while preserving account filtering and running-balance behavior.

**Tech Stack:** Static HTML, vanilla JavaScript modules, localStorage, PDF.js, Node.js built-in test runner, Playwright smoke test through Edge.

## Global Constraints

- Do not store uploaded statement files.
- Do not add bank login or direct bank connection.
- Do not overwrite existing account opening balances automatically.
- Existing accounts without new metadata fields must remain valid.
- Transaction row balances continue to be computed from full account history, not from the visible filter period.
- Dashboard date filtering must include both boundary dates.
- Keep the current manual account selector as a correction path.
- Bump `service-worker.js` cache version after changing app assets.

---

## File Structure

- Modify `assets/ledger-core.mjs`: add date-boundary filtering while keeping current month-filter support for existing callers and tests.
- Modify `tests/ledger-core.test.mjs`: add focused date-range filter tests and update affected dashboard filter expectations only when the implementation changes the public behavior.
- Modify `assets/ledger-importer.mjs`: add statement metadata extraction for China Merchants Bank transaction statements and return `accountCandidate` from `analyzeLedgerFile`.
- Modify `tests/ledger-importer.test.mjs`: add tests for account candidate extraction, opening balance estimate, and unchanged credit-card parsing.
- Modify `index.html`: replace the two month inputs with one date-range dropdown control and add a detected-account status area in import preview.
- Modify `assets/app.js`: add account matching, new-account creation during import confirmation, date-range state, date picker behavior, and account metadata normalization.
- Modify `assets/styles.css`: style the date-range dropdown and detected-account panel without disrupting existing dashboard density.
- Modify `tests/legacy-browser-smoke.test.mjs`: cover detected account assignment and day-level range filtering.
- Modify `service-worker.js`: increase cache name after app asset changes.

---

### Task 1: Core Day-Level Date Filtering

**Files:**
- Modify: `assets/ledger-core.mjs`
- Modify: `tests/ledger-core.test.mjs`

**Interfaces:**
- Consumes: existing `filterLedgerTransactions(transactions, filters)` and `summarizeSelection(transactions, filters)`.
- Produces: `filterLedgerTransactions` accepts optional `startDate?: string` and `endDate?: string` in addition to existing `months?: string[]` and `accountIds?: string[]`.

- [ ] **Step 1: Write the failing date-range filter test**

Add this test to `tests/ledger-core.test.mjs` near the existing filter tests:

```js
test("filters transactions by inclusive date range and account", () => {
  const transactions = filterLedgerTransactions(
    [
      { date: "2026-02-22", amount: -10, category: "餐饮", accountId: "cmb" },
      { date: "2026-02-23", amount: 31.74, category: "收入", accountId: "cmb" },
      { date: "2026-02-24", amount: -20, category: "交通", accountId: "cmb" },
      { date: "2026-02-25", amount: -30, category: "购物", accountId: "wechat" },
    ],
    { startDate: "2026-02-23", endDate: "2026-02-24", accountIds: ["cmb"] },
  );

  assert.deepEqual(transactions, [
    { date: "2026-02-23", amount: 31.74, category: "收入", accountId: "cmb" },
    { date: "2026-02-24", amount: -20, category: "交通", accountId: "cmb" },
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs
```

Expected: the new date-range test fails because `filterLedgerTransactions` ignores `startDate` and `endDate`.

- [ ] **Step 3: Implement date-boundary filtering**

Update `filterLedgerTransactions` in `assets/ledger-core.mjs` to normalize filters at the top:

```js
export function filterLedgerTransactions(transactions, filters = {}) {
  const months = new Set((filters.months || []).filter(Boolean));
  const accountIds = new Set((filters.accountIds || []).filter(Boolean));
  const startDate = isDateKey(filters.startDate) ? filters.startDate : "";
  const endDate = isDateKey(filters.endDate) ? filters.endDate : "";
  const shouldFilterMonths = months.size > 0 && !startDate && !endDate;
  const shouldFilterDates = Boolean(startDate || endDate);
  const shouldFilterAccounts = accountIds.size > 0;

  return transactions.filter((transaction) => {
    const date = String(transaction.date || "");
    const transactionMonth = date.slice(0, 7);
    const accountId = transaction.accountId || UNASSIGNED_ACCOUNT_ID;

    return (
      (!shouldFilterMonths || months.has(transactionMonth)) &&
      (!shouldFilterDates || isWithinDateRange(date, startDate, endDate)) &&
      (!shouldFilterAccounts || accountIds.has(accountId))
    );
  });
}
```

Add these helpers near the existing private helpers:

```js
function isWithinDateRange(date, startDate, endDate) {
  if (!isDateKey(date)) {
    return false;
  }

  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""));
}
```

- [ ] **Step 4: Run the core tests and verify they pass**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs
```

Expected: all `ledger-core` tests pass.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add assets\ledger-core.mjs tests\ledger-core.test.mjs
git commit -m "Add day-level ledger date filtering"
```

---

### Task 2: Statement Account Metadata Extraction

**Files:**
- Modify: `assets/ledger-importer.mjs`
- Modify: `tests/ledger-importer.test.mjs`

**Interfaces:**
- Consumes: existing `analyzeLedgerFile(file, options)` and `parseCmbTransactionStatementText(text)`.
- Produces: `analyzeLedgerFile` result includes `accountCandidate?: { institution: string, accountName: string, accountNumberLast4: string, accountFingerprint: string, openingBalanceEstimate: number }`.
- Produces: new exported `parseCmbTransactionStatement(text)` returning `{ transactions: Array<object>, accountCandidate: object | null }`.
- Keeps: `parseCmbTransactionStatementText(text)` returns only transactions for current tests and simple callers.

- [ ] **Step 1: Write the failing metadata extraction test**

Update the import list in `tests/ledger-importer.test.mjs`:

```js
import {
  analyzeLedgerFile,
  parseCmbCreditCardStatementText,
  parseCmbTransactionStatement,
} from "../assets/ledger-importer.mjs";
```

Add this test after the existing China Merchants Bank transaction statement test:

```js
test("extracts China Merchants Bank account candidate from transaction statement", () => {
  const result = parseCmbTransactionStatement(
    `招商银行交易流水
Transaction Statement of China Merchants Bank
卡 账号：6214850121113598
交易日期 币种 交易金额 账户余额 交易摘要 交易对方信息
2026-02-23 CNY 31.74 4,000.00 朝朝宝转出
2026-02-23 CNY -4,000.00 0.00 转账汇款 薛瑾 6214831001555389`,
  );

  assert.deepEqual(result.accountCandidate, {
    institution: "招商银行",
    accountName: "招商银行 尾号3598",
    accountNumberLast4: "3598",
    accountFingerprint: "cmb:3598",
    openingBalanceEstimate: 3968.26,
  });
});
```

Add this assertion to the existing `parses China Merchants Bank transaction statement rows by signed amount` test after `assert.equal(result.mode, "local");`:

```js
assert.deepEqual(result.accountCandidate, {
  institution: "招商银行",
  accountName: "招商银行 尾号3598",
  accountNumberLast4: "3598",
  accountFingerprint: "cmb:3598",
  openingBalanceEstimate: 3968.26,
});
```

- [ ] **Step 2: Run importer tests and verify they fail**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-importer.test.mjs
```

Expected: tests fail because `parseCmbTransactionStatement` is not exported and `analyzeLedgerFile` does not return `accountCandidate`.

- [ ] **Step 3: Implement parse result shape and metadata extraction**

In `assets/ledger-importer.mjs`, add:

```js
const CMB_INSTITUTION = "招商银行";
```

Change local parsing to use a result object:

```js
const localResult = parseLocalStatementText(extractedText, { fallbackYear });
const localTransactions = localResult.transactions;

if (localTransactions.length > 0) {
  return {
    transactions: localTransactions,
    accountCandidate: localResult.accountCandidate,
    mode: "local",
    message: "已使用本地解析生成预览",
  };
}
```

Make `parseLocalStatementText` return `{ transactions, accountCandidate }`:

```js
function parseLocalStatementText(text, options) {
  if (!text.trim()) {
    return { transactions: [], accountCandidate: null };
  }

  if (CMB_TRANSACTION_STATEMENT_PATTERN.test(text)) {
    return parseCmbTransactionStatement(text);
  }

  if (CMB_CREDIT_CARD_PATTERN.test(text)) {
    return {
      transactions: parseCmbCreditCardStatementText(text, options),
      accountCandidate: null,
    };
  }

  return {
    transactions: parseLedgerText(text, { fallbackYear: options.fallbackYear }).map(
      (transaction) => ({
        ...transaction,
        source: "file",
      }),
    ),
    accountCandidate: null,
  };
}
```

Add the new exported parser:

```js
export function parseCmbTransactionStatement(text) {
  const rows = [];

  for (const rawLine of String(text).split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+/gu, " ").trim();
    const parsed = parseCmbTransactionStatementLine(line);
    if (parsed) {
      rows.push(parsed);
    }
  }

  const transactions = rows.map(({ statementBalance, ...transaction }) => transaction);
  return {
    transactions,
    accountCandidate: buildCmbAccountCandidate(text, rows),
  };
}

export function parseCmbTransactionStatementText(text) {
  return parseCmbTransactionStatement(text).transactions;
}
```

Update `parseCmbTransactionStatementLine` so it captures the balance column:

```js
function parseCmbTransactionStatementLine(line) {
  const match = line.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+[A-Z]{3}\s+([-+]?\d[\d,]*\.\d{2})\s+([-+]?\d[\d,]*\.\d{2})(?:\s+(.+))?$/u,
  );
  if (!match) {
    return null;
  }

  const amount = parseAmount(match[4]);
  const statementBalance = parseAmount(match[5]);
  if (!Number.isFinite(amount) || amount === 0) {
    return null;
  }

  const direction = amount < 0 ? "expense" : "income";
  const signedAmount = direction === "expense" ? -Math.abs(amount) : Math.abs(amount);
  const description = String(match[6] || "招商银行交易").trim();

  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    description,
    amount: roundMoney(signedAmount),
    direction,
    category: inferCategory(description, direction),
    source: "file",
    statementBalance: Number.isFinite(statementBalance) ? roundMoney(statementBalance) : null,
  };
}
```

Add account candidate helpers:

```js
function buildCmbAccountCandidate(text, rows) {
  const accountNumber = findCmbStatementAccountNumber(text);
  if (!accountNumber) {
    return null;
  }

  const accountNumberLast4 = accountNumber.slice(-4);
  const firstRowWithBalance = rows.find((row) => Number.isFinite(row.statementBalance));
  const openingBalanceEstimate = firstRowWithBalance
    ? roundMoney(firstRowWithBalance.statementBalance - firstRowWithBalance.amount)
    : 0;

  return {
    institution: CMB_INSTITUTION,
    accountName: `${CMB_INSTITUTION} 尾号${accountNumberLast4}`,
    accountNumberLast4,
    accountFingerprint: `cmb:${accountNumberLast4}`,
    openingBalanceEstimate,
  };
}

function findCmbStatementAccountNumber(text) {
  const beforeTransactions = String(text).split(/\n(?=\d{4}-\d{2}-\d{2}\s+[A-Z]{3}\s+)/u)[0] || "";
  const candidates = [...beforeTransactions.matchAll(/\b\d{12,24}\b/gu)].map((match) => match[0]);
  return candidates[0] || "";
}
```

- [ ] **Step 4: Run importer tests and verify they pass**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-importer.test.mjs
```

Expected: all importer tests pass.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add assets\ledger-importer.mjs tests\ledger-importer.test.mjs
git commit -m "Extract statement account metadata"
```

---

### Task 3: Import Account Matching And New Account Creation

**Files:**
- Modify: `index.html`
- Modify: `assets/app.js`
- Modify: `assets/styles.css`
- Modify: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `analyzeLedgerFile(...).accountCandidate`.
- Produces: accounts may include optional `institution`, `accountNumberLast4`, and `accountFingerprint`.
- Produces: `state.pendingAccountCandidate`, `state.pendingAccountMode`, and `state.pendingMatchedAccountId`.

- [ ] **Step 1: Write browser smoke assertions for detected account import**

In `tests/legacy-browser-smoke.test.mjs`, after the existing upload/import block, add a second uploaded text statement with a detected account:

```js
await page.setInputFiles("#fileInput", {
  name: "cmb-transaction-statement.txt",
  mimeType: "text/plain",
  buffer: Buffer.from(`招商银行交易流水
Transaction Statement of China Merchants Bank
卡 账号：6214850121113598
交易日期 币种 交易金额 账户余额 交易摘要 交易对方信息
2026-07-05 CNY 31.74 4,000.00 朝朝宝转出`),
});
await page.click("#importButton");
await page.waitForTimeout(300);

assert.ok(await page.locator("#detectedAccountPanel").isVisible());
assert.match(await page.locator("#detectedAccountPanel").textContent(), /招商银行 尾号3598/u);
assert.match(await page.locator("#pendingRows tr").first().textContent(), /\+¥31\.74/u);

await page.click("#confirmImportButton");
await page.waitForTimeout(300);
assert.equal(
  await page.locator("#accountList input[value='招商银行 尾号3598']").count(),
  1,
);
```

- [ ] **Step 2: Run browser smoke and verify it fails**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: test fails because `#detectedAccountPanel` does not exist.

- [ ] **Step 3: Add detected-account markup**

In `index.html`, insert this block after the `import-account-control` label and before `.file-meta`:

```html
<div id="detectedAccountPanel" class="detected-account-panel is-hidden">
  <div>
    <strong id="detectedAccountTitle">未识别到账户</strong>
    <span id="detectedAccountDetail"></span>
  </div>
  <label id="addDetectedAccountControl" class="detected-account-choice">
    <input id="addDetectedAccountInput" type="checkbox" checked />
    <span>新增该账户并导入</span>
  </label>
</div>
```

Add elements to `assets/app.js`:

```js
detectedAccountPanel: document.querySelector("#detectedAccountPanel"),
detectedAccountTitle: document.querySelector("#detectedAccountTitle"),
detectedAccountDetail: document.querySelector("#detectedAccountDetail"),
addDetectedAccountControl: document.querySelector("#addDetectedAccountControl"),
addDetectedAccountInput: document.querySelector("#addDetectedAccountInput"),
```

Add initial state:

```js
pendingAccountCandidate: null,
pendingAccountMode: "manual",
pendingMatchedAccountId: "",
```

- [ ] **Step 4: Add account metadata normalization and matching**

Update `normalizeAccount(account)` in `assets/app.js`:

```js
return {
  ...account,
  name: String(account.name).trim(),
  openingBalance: parseMoneyInput(account.openingBalance),
  institution: String(account.institution || "").trim(),
  accountNumberLast4: String(account.accountNumberLast4 || "").trim(),
  accountFingerprint: String(account.accountFingerprint || "").trim(),
};
```

Add helpers:

```js
function resolveImportAccountCandidate(candidate) {
  if (!candidate) {
    return { mode: "manual", accountId: "", candidate: null };
  }

  const fingerprint = String(candidate.accountFingerprint || "").trim();
  const byFingerprint = fingerprint
    ? state.accounts.find((account) => account.accountFingerprint === fingerprint)
    : null;
  if (byFingerprint) {
    return { mode: "matched", accountId: byFingerprint.id, candidate };
  }

  const accountName = String(candidate.accountName || "").trim();
  const byName = accountName
    ? state.accounts.find((account) => account.name === accountName)
    : null;
  if (byName) {
    return { mode: "matched", accountId: byName.id, candidate };
  }

  return { mode: "new", accountId: "", candidate };
}

function createAccountFromCandidate(candidate) {
  const account = normalizeAccount({
    id: createId(),
    name: getAvailableAccountName(candidate.accountName, candidate.accountNumberLast4),
    openingBalance: candidate.openingBalanceEstimate,
    institution: candidate.institution,
    accountNumberLast4: candidate.accountNumberLast4,
    accountFingerprint: candidate.accountFingerprint,
    createdAt: new Date().toISOString(),
  });

  state.accounts = [...state.accounts, account].filter(Boolean);
  persistAccounts();
  return account;
}

function getAvailableAccountName(baseName, suffix) {
  const fallbackName = suffix ? `招商银行 尾号${suffix}` : "招商银行账户";
  const name = String(baseName || fallbackName).trim();
  if (!state.accounts.some((account) => account.name === name)) {
    return name;
  }

  const suffixedName = suffix ? `招商银行 尾号${suffix}` : `${name} 2`;
  if (!state.accounts.some((account) => account.name === suffixedName)) {
    return suffixedName;
  }

  let index = 2;
  while (state.accounts.some((account) => account.name === `${suffixedName} ${index}`)) {
    index += 1;
  }
  return `${suffixedName} ${index}`;
}
```

- [ ] **Step 5: Wire recognition results into account state**

In `importSelectedFile`, after `result.transactions.length > 0`, set pending account state:

```js
const accountResolution = resolveImportAccountCandidate(result.accountCandidate);
state.pendingAccountCandidate = accountResolution.candidate;
state.pendingAccountMode = accountResolution.mode;
state.pendingMatchedAccountId = accountResolution.accountId;

if (accountResolution.mode === "matched") {
  elements.importAccountInput.value = accountResolution.accountId;
} else if (accountResolution.mode === "new") {
  elements.addDetectedAccountInput.checked = true;
}
```

Update reset paths in `clearSelectedFile`, `discardPendingImport`, and empty import handling:

```js
clearPendingAccountCandidate();
```

Add:

```js
function clearPendingAccountCandidate() {
  state.pendingAccountCandidate = null;
  state.pendingAccountMode = "manual";
  state.pendingMatchedAccountId = "";
}
```

- [ ] **Step 6: Render detected-account status**

Call `renderDetectedAccountPanel()` inside `renderPendingImport()`.

Add:

```js
function renderDetectedAccountPanel() {
  const candidate = state.pendingAccountCandidate;
  const hasCandidate = Boolean(candidate && state.pendingTransactions.length > 0);
  elements.detectedAccountPanel.classList.toggle("is-hidden", !hasCandidate);
  if (!hasCandidate) {
    return;
  }

  if (state.pendingAccountMode === "matched") {
    const accountName = getAccountName(state.pendingMatchedAccountId);
    elements.detectedAccountTitle.textContent = `已匹配账户：${accountName}`;
    elements.detectedAccountDetail.textContent = candidate.accountNumberLast4
      ? `尾号 ${candidate.accountNumberLast4}`
      : "";
    elements.addDetectedAccountControl.classList.add("is-hidden");
    return;
  }

  elements.detectedAccountTitle.textContent = `识别到新账户：${candidate.accountName}`;
  elements.detectedAccountDetail.textContent = `初始金额 ${formatMoney(
    candidate.openingBalanceEstimate || 0,
  )}`;
  elements.addDetectedAccountControl.classList.remove("is-hidden");
}
```

- [ ] **Step 7: Create account during confirmation**

At the top of `confirmPendingImport`, replace current `importAccountId` logic:

```js
let importAccountId = normalizeAccountId(elements.importAccountInput.value);

if (
  state.pendingAccountMode === "new" &&
  state.pendingAccountCandidate &&
  elements.addDetectedAccountInput.checked
) {
  const createdAccount = createAccountFromCandidate(state.pendingAccountCandidate);
  importAccountId = createdAccount.id;
}

if (state.pendingAccountMode === "matched" && state.pendingMatchedAccountId) {
  importAccountId = state.pendingMatchedAccountId;
}
```

After saving imported rows, call:

```js
clearPendingAccountCandidate();
```

- [ ] **Step 8: Style detected account panel**

Add to `assets/styles.css` near import styles:

```css
.detected-account-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #c8ddd5;
  border-radius: 8px;
  background: #f4fbf8;
}

.detected-account-panel strong,
.detected-account-panel span {
  display: block;
}

.detected-account-panel strong {
  color: #153f34;
  font-size: 0.95rem;
}

.detected-account-panel span {
  color: #52645f;
  font-size: 0.82rem;
}

.detected-account-choice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
```

- [ ] **Step 9: Run browser smoke and importer tests**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-importer.test.mjs
```

Expected: both commands pass.

- [ ] **Step 10: Commit Task 3**

Run:

```powershell
git add index.html assets\app.js assets\styles.css tests\legacy-browser-smoke.test.mjs
git commit -m "Assign imports to detected accounts"
```

---

### Task 4: Single Day-Level Date Range Dropdown

**Files:**
- Modify: `index.html`
- Modify: `assets/app.js`
- Modify: `assets/styles.css`
- Modify: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: Task 1 `filterLedgerTransactions(..., { startDate, endDate })`.
- Produces: state keys `startDate`, `endDate`, `datePickerOpen`, `dateRangeDraftStart`, and `visibleCalendarMonth`.
- Removes dashboard dependency on `startMonthInput` and `endMonthInput`.

- [ ] **Step 1: Write browser smoke coverage for day range selection**

Update the existing month filter section in `tests/legacy-browser-smoke.test.mjs`.

Replace:

```js
await page.fill("#startMonthInput", "2026-07");
await page.fill("#endMonthInput", "2026-07");
await page.dispatchEvent("#startMonthInput", "change");
await page.dispatchEvent("#endMonthInput", "change");
```

With:

```js
await page.click("#dateRangeButton");
await page.click('[data-date-value="2026-07-02"]');
await page.click('[data-date-value="2026-07-02"]');
```

Later, replace the end-month widening step:

```js
await page.fill("#endMonthInput", "2026-08");
await page.dispatchEvent("#endMonthInput", "change");
```

With:

```js
await page.click("#dateRangeButton");
await page.click('[data-date-value="2026-07-02"]');
await page.click("#nextCalendarMonthButton");
await page.click('[data-date-value="2026-08-03"]');
```

- [ ] **Step 2: Run browser smoke and verify it fails**

Run:

```powershell
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: fails because date range controls do not exist.

- [ ] **Step 3: Replace month inputs with date-range markup**

In `index.html`, replace the two `.month-control` labels with:

```html
<div class="date-range-control">
  <span>周期</span>
  <button id="dateRangeButton" class="date-range-button" type="button" aria-expanded="false">
    <span id="dateRangeLabel">选择周期</span>
  </button>
  <div id="dateRangePanel" class="date-range-panel is-hidden">
    <div class="calendar-toolbar">
      <button id="prevCalendarMonthButton" class="icon-button" type="button" aria-label="上个月">
        ‹
      </button>
      <strong id="calendarMonthLabel"></strong>
      <button id="nextCalendarMonthButton" class="icon-button" type="button" aria-label="下个月">
        ›
      </button>
    </div>
    <div class="calendar-weekdays" aria-hidden="true">
      <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
    </div>
    <div id="calendarDays" class="calendar-days"></div>
  </div>
</div>
```

- [ ] **Step 4: Add date-range state and elements**

In `assets/app.js`, replace state month keys:

```js
startDate: getCurrentMonthStartDate(),
endDate: getToday(),
datePickerOpen: false,
dateRangeDraftStart: "",
visibleCalendarMonth: getCurrentMonth(),
```

Replace elements:

```js
dateRangeButton: document.querySelector("#dateRangeButton"),
dateRangeLabel: document.querySelector("#dateRangeLabel"),
dateRangePanel: document.querySelector("#dateRangePanel"),
calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
calendarDays: document.querySelector("#calendarDays"),
prevCalendarMonthButton: document.querySelector("#prevCalendarMonthButton"),
nextCalendarMonthButton: document.querySelector("#nextCalendarMonthButton"),
```

Remove initialization writes to `startMonthInput` and `endMonthInput`.

- [ ] **Step 5: Bind date-range control events**

Replace old month input listeners with:

```js
elements.dateRangeButton.addEventListener("click", () => {
  state.datePickerOpen = !state.datePickerOpen;
  state.visibleCalendarMonth = state.startDate.slice(0, 7) || getCurrentMonth();
  renderDateRangeFilter();
});

elements.prevCalendarMonthButton.addEventListener("click", () => {
  state.visibleCalendarMonth = getPreviousMonth(state.visibleCalendarMonth);
  renderDateRangeFilter();
});

elements.nextCalendarMonthButton.addEventListener("click", () => {
  state.visibleCalendarMonth = getNextMonth(state.visibleCalendarMonth);
  renderDateRangeFilter();
});

elements.calendarDays.addEventListener("click", (event) => {
  const button = event.target.closest("[data-date-value]");
  if (!button) {
    return;
  }

  selectDateRangeBoundary(button.dataset.dateValue);
});
```

Add:

```js
function selectDateRangeBoundary(dateValue) {
  if (!state.dateRangeDraftStart) {
    state.dateRangeDraftStart = dateValue;
    state.startDate = dateValue;
    state.endDate = dateValue;
    render();
    return;
  }

  const [startDate, endDate] = normalizeDateRange(state.dateRangeDraftStart, dateValue);
  state.startDate = startDate;
  state.endDate = endDate;
  state.dateRangeDraftStart = "";
  state.datePickerOpen = false;
  render();
}
```

- [ ] **Step 6: Render calendar days**

Add these helpers in `assets/app.js` near current date helpers:

```js
function renderDateRangeFilter() {
  const [startDate, endDate] = normalizeDateRange(state.startDate, state.endDate);
  state.startDate = startDate;
  state.endDate = endDate;
  elements.dateRangeLabel.textContent = getDateRangeLabel();
  elements.dateRangeButton.setAttribute("aria-expanded", String(state.datePickerOpen));
  elements.dateRangePanel.classList.toggle("is-hidden", !state.datePickerOpen);
  elements.calendarMonthLabel.textContent = `${state.visibleCalendarMonth.slice(0, 4)}年${Number(
    state.visibleCalendarMonth.slice(5, 7),
  )}月`;

  replaceChildrenCompat(
    elements.calendarDays,
    ...getCalendarDayItems(state.visibleCalendarMonth).map(createCalendarDayButton),
  );
}

function getCalendarDayItems(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const items = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    items.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    items.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return items;
}

function createCalendarDayButton(dateValue) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "calendar-day";
  if (!dateValue) {
    button.disabled = true;
    button.setAttribute("aria-hidden", "true");
    return button;
  }

  const inRange = dateValue >= state.startDate && dateValue <= state.endDate;
  button.dataset.dateValue = dateValue;
  button.textContent = String(Number(dateValue.slice(8, 10)));
  button.classList.toggle("is-selected", dateValue === state.startDate || dateValue === state.endDate);
  button.classList.toggle("is-in-range", inRange);
  return button;
}
```

Add:

```js
function normalizeDateRange(startDate, endDate) {
  const today = getToday();
  const safeStart = isDateKey(startDate) ? startDate : getCurrentMonthStartDate();
  const safeEnd = isDateKey(endDate) ? endDate : today;
  return safeStart <= safeEnd ? [safeStart, safeEnd] : [safeEnd, safeStart];
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/u.test(String(value || ""));
}

function getCurrentMonthStartDate() {
  return `${getCurrentMonth()}-01`;
}

function getDateRangeLabel() {
  return state.startDate === state.endDate
    ? state.startDate
    : `${state.startDate} 至 ${state.endDate}`;
}

function getPreviousMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear}-${String(previousMonth).padStart(2, "0")}`;
}
```

- [ ] **Step 7: Replace dashboard filter calls**

In `render()`, replace:

```js
months: getSelectedMonths(),
```

with:

```js
startDate: state.startDate,
endDate: state.endDate,
```

Do this for summary, balance snapshot filters, visible rows, and export.

Replace `getMonthRangeLabel()` with:

```js
function getDateRangeFileLabel() {
  return state.startDate === state.endDate ? state.startDate : `${state.startDate}_${state.endDate}`;
}
```

Use it in `exportTransactions()`:

```js
link.download = `AI财舵-${getDateRangeFileLabel()}.csv`;
```

Remove `getSelectedMonths`, `getMonthRangeLabel`, and `normalizeMonthRange` from app code after callers are gone.

- [ ] **Step 8: Add date picker styles**

Add to `assets/styles.css` near dashboard filter styles:

```css
.date-range-control {
  position: relative;
  display: grid;
  gap: 6px;
}

.date-range-button {
  height: 42px;
  border: 1px solid #c9d8d2;
  border-radius: 8px;
  background: #fff;
  color: #173f35;
  padding: 0 12px;
  text-align: left;
}

.date-range-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: min(320px, 88vw);
  padding: 12px;
  border: 1px solid #c9d8d2;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 18px 40px rgba(24, 57, 47, 0.14);
}

.calendar-toolbar,
.calendar-weekdays,
.calendar-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.calendar-toolbar {
  grid-template-columns: 36px 1fr 36px;
  align-items: center;
  margin-bottom: 10px;
}

.calendar-toolbar strong {
  text-align: center;
}

.calendar-weekdays {
  color: #697c76;
  font-size: 0.78rem;
  margin-bottom: 4px;
  text-align: center;
}

.calendar-day {
  aspect-ratio: 1;
  border: 0;
  border-radius: 6px;
  background: #f4f7f6;
  color: #173f35;
}

.calendar-day:disabled {
  background: transparent;
}

.calendar-day.is-in-range {
  background: #dff1eb;
}

.calendar-day.is-selected {
  background: #1f8a70;
  color: #fff;
}
```

- [ ] **Step 9: Run full tests**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs tests\ledger-importer.test.mjs
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: all tests pass.

- [ ] **Step 10: Commit Task 4**

Run:

```powershell
git add index.html assets\app.js assets\styles.css tests\legacy-browser-smoke.test.mjs
git commit -m "Replace month filters with date range picker"
```

---

### Task 5: Cache Version, Real PDF Verification, And Publish

**Files:**
- Modify: `service-worker.js`

**Interfaces:**
- Consumes: tasks 1-4.
- Produces: deployed GitHub Pages app loads updated JS/CSS through a new cache name.

- [ ] **Step 1: Bump service worker cache**

In `service-worker.js`, change:

```js
const CACHE_NAME = "ai-caiduo-v11";
```

to:

```js
const CACHE_NAME = "ai-caiduo-v12";
```

- [ ] **Step 2: Run full test suite**

Run:

```powershell
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\ledger-core.test.mjs tests\ledger-importer.test.mjs
$env:NODE_PATH = "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules"
& "C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --test tests\legacy-browser-smoke.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Verify the user's real PDF locally**

Use Playwright to upload:

```text
C:\Users\47215\OneDrive\Desktop\招商银行交易流水(申请时间2026年07月18日16时02分56秒).pdf
```

Expected local UI observations:

- `2026-02-23 朝朝宝转出` appears as `+¥31.74`.
- The detected account panel shows `招商银行 尾号3598`.
- Confirming import creates or matches the `招商银行 尾号3598` account.
- Imported rows show that account in the transaction table.
- Selecting a date range ending before `2026-02-23` hides that row; selecting a range containing `2026-02-23` shows it.

- [ ] **Step 4: Commit cache bump**

Run:

```powershell
git add service-worker.js
git commit -m "Refresh app cache for account detection"
```

- [ ] **Step 5: Push to GitHub Pages**

Run:

```powershell
git push origin master
```

Expected: push succeeds and updates `master`.

- [ ] **Step 6: Verify online resources refresh**

Poll:

```powershell
$sw = Invoke-WebRequest -Uri "https://rrrot507.github.io/ai-caiduo-pages/service-worker.js?check=$(Get-Random)" -UseBasicParsing -Headers @{"Cache-Control"="no-cache"}
$sw.Content.Contains("ai-caiduo-v12")
```

Expected: `True`.

- [ ] **Step 7: Verify online PDF import**

Open the deployed site in a clean Playwright context, clear `localStorage` and caches, upload the same PDF, and confirm:

- `2026-02-23 朝朝宝转出` appears as `+¥31.74`.
- The detected account panel shows `招商银行 尾号3598`.
- Confirming import creates or matches that account.
- Day-level date range filtering works on the deployed site.

---

## Self-Review

- Spec coverage: account detection, new-account prompt, account metadata, opening balance estimate, manual fallback, day-level filtering, one dropdown date-range interaction, row-balance invariance, tests, and cache refresh are each covered by tasks.
- Placeholder scan: the plan uses exact filenames, exact function names, concrete code snippets, exact commands, and expected results.
- Type consistency: `accountCandidate`, `accountFingerprint`, `accountNumberLast4`, `openingBalanceEstimate`, `startDate`, and `endDate` are named consistently across parser, app state, tests, and UI tasks.
