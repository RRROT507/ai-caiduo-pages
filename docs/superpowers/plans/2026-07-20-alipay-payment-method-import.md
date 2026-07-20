# Alipay Payment Method Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Alipay statements without double-counting bank-card payments, while annotating matched existing bank-card transactions with concise Alipay details.

**Architecture:** Keep PDF/text extraction in `assets/ledger-importer.mjs`. Add Alipay-specific parse output as reconciliation items beside normal import transactions. Keep account and existing-transaction matching in `assets/app.js`, because only the app has access to saved accounts and ledger rows.

**Tech Stack:** Browser JavaScript modules, PDF.js text extraction, Node test runner, Playwright/Edge smoke tests, GitHub Pages service worker cache.

## Global Constraints

- Do not create new transactions for Alipay rows paid by linked bank cards.
- Only `支付宝`, `支付宝余额`, or `余额` payment methods can create Alipay-account transactions.
- Matched bank-card rows update existing transaction descriptions idempotently.
- Unmatched bank cards, unmatched existing rows, ambiguous matches, zero-amount rows, and `不计收支` rows are warnings/skips.
- Category improvements may only replace fallback categories with high-confidence, type-compatible recommendations.
- Preserve existing CMB parsing, account matching, transfer/refund tagging, row-balance behavior, and dashboard filtering.
- Use TDD: write a failing test, watch it fail, then implement minimal code.

---

## File Structure

- Modify `assets/ledger-importer.mjs`: Alipay statement detection, row parsing, payment method classification, and reconciliation item output.
- Modify `assets/app.js`: pending update state, bank-card account resolution, existing transaction matching, description/category update confirmation, and preview rendering.
- Modify `tests/ledger-importer.test.mjs`: unit coverage for Alipay parser and payment-method classification.
- Modify `tests/legacy-browser-smoke.test.mjs`: browser coverage for matched bank-card annotation, unmatched-card warning, and true Alipay-account import.
- Modify `service-worker.js`: bump cache name from `ai-caiduo-v22` to `ai-caiduo-v23`.

---

### Task 1: Parse Alipay Statement Rows Without Creating Bank-Card Transactions

**Files:**
- Modify: `assets/ledger-importer.mjs`
- Test: `tests/ledger-importer.test.mjs`

**Interfaces:**
- Produces: `parseAlipayStatement(text, options = {}) -> { transactions, reconciliationItems, skippedItems, accountCandidate }`
- Produces: `classifyAlipayPaymentMethod(methodText) -> { scope, candidate, normalizedMethod }`
- Consumes: existing `inferCategory`, `roundMoney`, `parseAmount`, and `normalizeDate` behavior.

- [ ] **Step 1: Write failing parser tests**

Add this import in `tests/ledger-importer.test.mjs`:

```js
import {
  analyzeLedgerFile,
  classifyAlipayPaymentMethod,
  parseAlipayStatement,
  parseCmbCreditCardStatementText,
  parseCmbTransactionStatement,
} from "../assets/ledger-importer.mjs";
```

Add tests:

```js
test("classifies Alipay payment methods by account scope", () => {
  assert.deepEqual(classifyAlipayPaymentMethod("招商银行信用卡(1755)"), {
    scope: "bank-account",
    normalizedMethod: "招商银行信用卡(1755)",
    candidate: {
      institution: "招商银行",
      accountKind: "credit-card",
      accountNumberLast4: "1755",
      accountFingerprint: "cmb-credit-card:1755",
      displayName: "招商银行信用卡 尾号1755",
    },
  });

  assert.deepEqual(classifyAlipayPaymentMethod("支付宝余额"), {
    scope: "alipay-account",
    normalizedMethod: "支付宝余额",
    candidate: null,
  });

  assert.equal(classifyAlipayPaymentMethod("").scope, "unknown");
});

test("parses Alipay bank-card rows as reconciliation items only", () => {
  const result = parseAlipayStatement(`支付宝支付科技有限公司 交易流水证明
收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间
支出 高德打车 高德打车订单 招商银行信用卡(1755) 14.49 20260324220014662214274 0003N202603240000000014 2026-03-24 21:53:45
不计收支 上海顺途科技有限公司 退款-北京丰台运城北 招商银行信用卡(1755) 317.50 20260311230014662214193 20260311ALPP00101750541 2026-03-31 00:08:52`);

  assert.equal(result.transactions.length, 0);
  assert.equal(result.reconciliationItems.length, 1);
  assert.equal(result.skippedItems.length, 1);
  assert.deepEqual(
    result.reconciliationItems.map(({ date, counterparty, product, paymentMethod, amount, direction, category, paymentAccountCandidate }) => ({
      date,
      counterparty,
      product,
      paymentMethod,
      amount,
      direction,
      category,
      paymentAccountCandidate,
    })),
    [
      {
        date: "2026-03-24",
        counterparty: "高德打车",
        product: "高德打车订单",
        paymentMethod: "招商银行信用卡(1755)",
        amount: -14.49,
        direction: "expense",
        category: "交通",
        paymentAccountCandidate: {
          institution: "招商银行",
          accountKind: "credit-card",
          accountNumberLast4: "1755",
          accountFingerprint: "cmb-credit-card:1755",
          displayName: "招商银行信用卡 尾号1755",
        },
      },
    ],
  );
});

test("parses Alipay balance rows as importable Alipay transactions", () => {
  const result = parseAlipayStatement(`支付宝支付科技有限公司 交易流水证明
收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间
支出 星巴克 星巴克咖啡 支付宝余额 32.50 20260301220014662214274 A0001 2026-03-01 09:30:00`);

  assert.equal(result.reconciliationItems.length, 0);
  assert.deepEqual(
    result.transactions.map(({ date, description, amount, direction, category, source }) => ({
      date,
      description,
      amount,
      direction,
      category,
      source,
    })),
    [
      {
        date: "2026-03-01",
        description: "星巴克 - 星巴克咖啡",
        amount: -32.5,
        direction: "expense",
        category: "餐饮",
        source: "file",
      },
    ],
  );
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\ledger-importer.test.mjs
```

Expected: FAIL because `parseAlipayStatement` and `classifyAlipayPaymentMethod` are not exported.

- [ ] **Step 3: Implement minimal importer support**

In `assets/ledger-importer.mjs`, add:

```js
const ALIPAY_STATEMENT_PATTERN = /支付宝支付科技有限公司|交易流水证明|收\/付款方式/u;
```

Update `parseLocalStatementText` before the CMB checks:

```js
if (ALIPAY_STATEMENT_PATTERN.test(text)) {
  return parseAlipayStatement(text, options);
}
```

Add exported functions:

```js
export function classifyAlipayPaymentMethod(methodText) {
  const normalizedMethod = normalizeAlipayCell(methodText);
  if (!normalizedMethod) {
    return { scope: "unknown", normalizedMethod, candidate: null };
  }

  if (/^(?:支付宝|支付宝余额|余额)$/u.test(normalizedMethod)) {
    return { scope: "alipay-account", normalizedMethod, candidate: null };
  }

  const suffixMatch = normalizedMethod.match(/[（(](\d{4})[）)]/u);
  const accountNumberLast4 = suffixMatch ? suffixMatch[1] : "";
  if (/银行|信用卡|储蓄卡|银行卡/u.test(normalizedMethod)) {
    const institution = normalizedMethod.includes("招商银行") ? "招商银行" : "";
    const accountKind = normalizedMethod.includes("信用卡") ? "credit-card" : "bank-card";
    const prefix = institution === "招商银行" && accountKind === "credit-card" ? "cmb-credit-card" : "bank-card";
    return {
      scope: "bank-account",
      normalizedMethod,
      candidate: {
        institution,
        accountKind,
        accountNumberLast4,
        accountFingerprint: accountNumberLast4 ? `${prefix}:${accountNumberLast4}` : "",
        displayName: `${institution || "银行卡"}${accountKind === "credit-card" ? "信用卡" : ""}${
          accountNumberLast4 ? ` 尾号${accountNumberLast4}` : ""
        }`.trim(),
      },
    };
  }

  return { scope: "unknown", normalizedMethod, candidate: null };
}

export function parseAlipayStatement(text, options = {}) {
  const rows = parseAlipayRows(text);
  const transactions = [];
  const reconciliationItems = [];
  const skippedItems = [];

  for (const row of rows) {
    const parsed = normalizeAlipayRow(row);
    if (!parsed) {
      continue;
    }
    if (parsed.skipReason) {
      skippedItems.push(parsed);
      continue;
    }
    if (parsed.paymentScope === "alipay-account") {
      transactions.push(toAlipayTransaction(parsed));
    } else if (parsed.paymentScope === "bank-account") {
      reconciliationItems.push(toAlipayReconciliationItem(parsed));
    } else {
      skippedItems.push({ ...parsed, skipReason: "unsupported-payment-method" });
    }
  }

  return {
    transactions,
    reconciliationItems,
    skippedItems,
    accountCandidate: null,
  };
}
```

Add helpers directly below. The implementation should:

```js
function parseAlipayRows(text) {
  const lines = String(text)
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const rows = [];
  let block = [];

  for (const line of lines) {
    if (/^(?:支出|收入|不计\s*收支)\s+/u.test(line)) {
      if (block.length > 0) {
        rows.push(parseAlipayBlock(block));
      }
      block = [line];
    } else if (block.length > 0) {
      block.push(line);
    }
  }
  if (block.length > 0) {
    rows.push(parseAlipayBlock(block));
  }

  return rows.filter(Boolean);
}
```

Implement `parseAlipayBlock(block)` with two paths:

- First, support clean table-like rows:

```js
const clean = block.join(" ").replace(/\s+/gu, " ").trim();
const cleanMatch = clean.match(
  /^(支出|收入|不计\s*收支)\s+(.+?)\s+(.+?)\s+(.+?)\s+([-+]?\d[\d,]*\.\d{2})\s+\S+\s+\S+\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?/u,
);
```

- Then add fallback parsing for wrapped PDF lines by finding date, amount, payment method keyword, and card suffix inside the block.

Also add:

```js
function normalizeAlipayCell(value) {
  return String(value || "").replace(/\s+/gu, "").trim();
}

function buildAlipayDescription(counterparty, product) {
  const parts = [counterparty, product]
    .map((part) => normalizeAlipayDisplayText(part))
    .filter(Boolean);
  return [...new Set(parts)].join(" - ");
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\ledger-importer.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add assets\ledger-importer.mjs tests\ledger-importer.test.mjs
git commit -m "Parse Alipay payment methods"
```

---

### Task 2: Match Bank-Card Alipay Rows To Existing Ledger Transactions

**Files:**
- Modify: `assets/app.js`
- Test: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `result.reconciliationItems` from `analyzeLedgerFile`.
- Produces: `state.pendingTransactionUpdates: Array<{ previewId, targetId, nextDescription, nextCategory, supplement, ... }>`
- Produces: `appendAlipaySupplement(description, supplement) -> string`

- [ ] **Step 1: Write failing browser test**

In `tests/legacy-browser-smoke.test.mjs`, add a test before the date-range tests:

```js
test("annotates matched bank-card transactions from Alipay statements without creating duplicates", async (t) => {
  if (!existsSync(edgePath)) {
    t.skip("Microsoft Edge is not available in this environment");
    return;
  }

  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    t.skip("Playwright is not available in this environment");
    return;
  }

  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true, executablePath: edgePath });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify([
          {
            id: "credit-1755",
            name: "招商银行信用卡 尾号1755",
            institution: "招商银行",
            accountNumberLast4: "1755",
            accountFingerprint: "cmb-credit-card:1755",
            openingBalance: 0,
          },
          { id: "alipay", name: "支付宝", openingBalance: 0 },
        ]),
      );
      localStorage.setItem(
        "ai-caiduo-transactions-v1",
        JSON.stringify([
          {
            id: "gaode-card-row",
            date: "2026-03-24",
            description: "高德打车",
            amount: -14.49,
            direction: "expense",
            category: "其他支出",
            accountId: "credit-1755",
            sequence: 1,
          },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.setInputFiles("#fileInput", {
      name: "alipay-bank-card.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "支付宝支付科技有限公司 交易流水证明\n" +
          "收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间\n" +
          "支出 高德打车 高德打车订单 招商银行信用卡(1755) 14.49 20260324220014662214274 0003N202603240000000014 2026-03-24 21:53:45",
      ),
    });
    await page.click("#importButton");
    await page.waitForFunction(() =>
      (document.querySelector("#importStatus")?.textContent || "").includes("请确认"),
    );

    assert.match(await page.locator("#pendingPanel").textContent(), /将补充已有流水/u);
    assert.equal(await page.locator("#pendingRows tr").count(), 1);

    await page.click("#confirmImportButton");
    await page.waitForFunction(() =>
      (document.querySelector("#importStatus")?.textContent || "").includes("补充"),
    );

    const savedTransactions = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ai-caiduo-transactions-v1") || "[]"),
    );
    assert.equal(savedTransactions.length, 1);
    assert.equal(
      savedTransactions[0].description,
      "高德打车；支付宝补充：高德打车 - 高德打车订单",
    );
    assert.equal(savedTransactions[0].category, "交通");
  } finally {
    await browser.close();
    await server.close();
  }
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-name-pattern "annotates matched bank-card" tests\legacy-browser-smoke.test.mjs
```

Expected: FAIL because reconciliation items are ignored by the app.

- [ ] **Step 3: Add pending update state and rendering**

In `assets/app.js`, add to `state`:

```js
pendingTransactionUpdates: [],
pendingImportNotices: [],
```

Add:

```js
function hasPendingImportItems() {
  return state.pendingTransactions.length > 0 || state.pendingTransactionUpdates.length > 0;
}
```

Update `renderPendingImport`:

```js
const hasPending = hasPendingImportItems();
const pendingCount = state.pendingTransactions.length + state.pendingTransactionUpdates.length;
elements.pendingPanel.classList.toggle("is-hidden", !hasPending && state.pendingImportNotices.length === 0);
elements.pendingCount.textContent = `${pendingCount} 条`;
elements.confirmImportButton.disabled = !hasPending;
replaceChildrenCompat(
  elements.pendingRows,
  ...state.pendingTransactions.map(createPendingRow),
  ...state.pendingTransactionUpdates.map(createPendingUpdateRow),
);
renderDetectedAccountPanel();
```

Add `createPendingUpdateRow(update)`:

```js
function createPendingUpdateRow(update) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td data-label="日期">${escapeHtml(update.date)}</td>
    <td data-label="说明">${escapeHtml(`将补充已有流水：${update.nextDescription}`)}</td>
    <td data-label="分类">${escapeHtml(update.nextCategory || update.category)}</td>
    <td data-label="金额" class="amount-cell">${escapeHtml(formatSignedMoney(update.amount))}</td>
    <td data-label="操作" class="action-cell">
      <button class="delete-button" type="button" data-delete-pending-update-id="${escapeHtml(
        update.previewId,
      )}">删除</button>
    </td>
  `;
  return row;
}
```

Handle delete clicks in `elements.pendingRows.addEventListener("click", ...)`:

```js
const updateButton = event.target.closest("[data-delete-pending-update-id]");
if (updateButton) {
  deletePendingTransactionUpdate(updateButton.dataset.deletePendingUpdateId);
  return;
}
```

Add:

```js
function deletePendingTransactionUpdate(previewId) {
  state.pendingTransactionUpdates = state.pendingTransactionUpdates.filter(
    (update) => update.previewId !== previewId,
  );
  renderPendingImport();
}
```

- [ ] **Step 4: Add matching and annotation helpers**

Add these helpers in `assets/app.js` near account-candidate helpers:

```js
function buildAlipayTransactionUpdates(reconciliationItems, categoryHistory) {
  const updates = [];
  const notices = [];

  for (const item of reconciliationItems || []) {
    const account = findAccountForPaymentCandidate(item.paymentAccountCandidate);
    if (!account) {
      notices.push(`识别到${item.paymentAccountCandidate?.displayName || item.paymentMethod}，但本地没有匹配账户，已跳过。`);
      continue;
    }

    const match = findExistingTransactionForAlipayItem(item, account.id);
    if (match.status !== "matched") {
      notices.push(match.message);
      continue;
    }

    const supplement = buildAlipaySupplement(item);
    const type = getTransactionType(match.transaction);
    const recommendation = recommendCategory(`${item.counterparty} ${item.product}`, {
      type,
      history: categoryHistory,
    });
    const nextCategory =
      isFallbackCategory(match.transaction.category, type) &&
      recommendation.confidence === "high" &&
      (recommendation.source === "rule" || recommendation.source === "user-history")
        ? recommendation.category
        : normalizeTransactionCategory(match.transaction.category, type, match.transaction.description);

    updates.push({
      previewId: createId(),
      targetId: match.transaction.id,
      date: item.date,
      description: match.transaction.description,
      nextDescription: appendAlipaySupplement(match.transaction.description, supplement),
      amount: match.transaction.amount,
      direction: match.transaction.direction,
      category: match.transaction.category,
      nextCategory,
      supplement,
      paymentMethod: item.paymentMethod,
    });
  }

  return { updates, notices };
}
```

Add:

```js
function findAccountForPaymentCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  const fingerprint = String(candidate.accountFingerprint || "").trim();
  if (fingerprint) {
    const exact = state.accounts.find((account) => account.accountFingerprint === fingerprint);
    if (exact) {
      return exact;
    }
  }

  const suffix = String(candidate.accountNumberLast4 || "").trim();
  if (!suffix) {
    return null;
  }

  return (
    state.accounts.find((account) =>
      String(account.accountNumberLast4 || "")
        .split("/")
        .includes(suffix),
    ) ||
    state.accounts.find((account) => {
      const name = String(account.name || "");
      return name.includes(suffix) && (!candidate.institution || name.includes(candidate.institution));
    }) ||
    null
  );
}
```

Add deterministic transaction matching:

```js
function findExistingTransactionForAlipayItem(item, accountId) {
  const candidates = state.transactions.filter((transaction) => {
    const type = getTransactionType(transaction);
    if (type === "transfer" || type === "refunded") {
      return false;
    }
    return (
      transaction.accountId === accountId &&
      transaction.date === item.date &&
      roundMoney(Math.abs(transaction.amount)) === roundMoney(Math.abs(item.amount)) &&
      getTransactionType(transaction) === item.direction
    );
  });

  if (candidates.length === 0) {
    return {
      status: "missing",
      message: `未找到可补充的已有流水：${item.paymentAccountCandidate?.displayName || item.paymentMethod} ${item.date} ${formatMoney(Math.abs(item.amount))}，已跳过。`,
    };
  }

  if (candidates.length === 1) {
    return { status: "matched", transaction: candidates[0] };
  }

  const scored = candidates
    .map((transaction) => ({ transaction, score: scoreAlipayDescriptionMatch(transaction, item) }))
    .sort((a, b) => b.score - a.score);
  if (scored[0].score > 0 && scored[0].score > scored[1].score) {
    return { status: "matched", transaction: scored[0].transaction };
  }

  return {
    status: "ambiguous",
    message: `找到多条可能匹配的已有流水：${item.paymentAccountCandidate?.displayName || item.paymentMethod} ${item.date} ${formatMoney(Math.abs(item.amount))}，已跳过。`,
  };
}
```

Add:

```js
function buildAlipaySupplement(item) {
  return [item.counterparty, item.product]
    .map((part) => String(part || "").replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(" - ");
}

function appendAlipaySupplement(description, supplement) {
  const cleanSupplement = String(supplement || "").replace(/\s+/gu, " ").trim();
  const original = String(description || "").trim();
  if (!cleanSupplement || original.includes(`支付宝补充：${cleanSupplement}`)) {
    return original;
  }
  return `${original}；支付宝补充：${cleanSupplement}`;
}
```

- [ ] **Step 5: Wire import and confirm**

In `importSelectedFile`, replace the empty-result check with:

```js
const hasRecognizedItems =
  result.transactions.length > 0 ||
  (result.reconciliationItems || []).length > 0 ||
  (result.skippedItems || []).length > 0;
if (!hasRecognizedItems) {
  state.pendingTransactions = [];
  state.pendingTransactionUpdates = [];
  state.pendingImportNotices = [];
  clearPendingAccountCandidate();
  renderPendingImport();
  setImportStatus(result.message || "没有识别到可导入交易");
  return;
}
```

After building `state.pendingTransactions`, add:

```js
const alipayUpdates = buildAlipayTransactionUpdates(result.reconciliationItems || [], categoryHistory);
state.pendingTransactionUpdates = alipayUpdates.updates;
state.pendingImportNotices = [
  ...alipayUpdates.notices,
  ...(result.skippedItems || []).map(formatAlipaySkippedNotice),
];
```

In `confirmPendingImport`, update existing transactions before clearing pending state:

```js
const updateById = new Map(
  state.pendingTransactionUpdates.map((update) => [
    update.targetId,
    {
      description: update.nextDescription,
      category: update.nextCategory,
    },
  ]),
);
const updatedTransactions = state.transactions.map((transaction) =>
  updateById.has(transaction.id) ? { ...transaction, ...updateById.get(transaction.id) } : transaction,
);
state.transactions = [...imported, ...updatedTransactions];
```

Clear `pendingTransactionUpdates` and `pendingImportNotices` in `confirmPendingImport`, `discardPendingImport`, `clearPendingAccountCandidate`, and no-result/error paths.

- [ ] **Step 6: Run targeted browser test**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-name-pattern "annotates matched bank-card" tests\legacy-browser-smoke.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add assets\app.js tests\legacy-browser-smoke.test.mjs
git commit -m "Annotate matched Alipay bank-card transactions"
```

---

### Task 3: Show Skips Clearly And Import True Alipay-Account Rows

**Files:**
- Modify: `assets/app.js`
- Test: `tests/legacy-browser-smoke.test.mjs`

**Interfaces:**
- Consumes: `state.pendingImportNotices`
- Produces: warnings in `#detectedAccountPanel` or `#importStatus`

- [ ] **Step 1: Write failing browser tests**

Add:

```js
test("skips unmatched Alipay bank cards without adding transactions", async (t) => {
  if (!existsSync(edgePath)) {
    t.skip("Microsoft Edge is not available in this environment");
    return;
  }
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    t.skip("Playwright is not available in this environment");
    return;
  }

  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true, executablePath: edgePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.setInputFiles("#fileInput", {
      name: "alipay-unmatched-card.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "支付宝支付科技有限公司 交易流水证明\n" +
          "收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间\n" +
          "支出 高德打车 高德打车订单 招商银行信用卡(1755) 14.49 20260324220014662214274 0003N202603240000000014 2026-03-24 21:53:45",
      ),
    });
    await page.click("#importButton");
    await page.waitForSelector("#detectedAccountPanel:not(.is-hidden)");

    assert.match(await page.locator("#detectedAccountPanel").textContent(), /没有匹配账户/u);
    assert.equal(await page.locator("#pendingRows tr").count(), 0);
    assert.equal(await page.locator("#confirmImportButton").isDisabled(), true);
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("ai-caiduo-transactions-v1") || "[]")),
      [],
    );
  } finally {
    await browser.close();
    await server.close();
  }
});

test("imports true Alipay balance rows into the selected Alipay account", async (t) => {
  if (!existsSync(edgePath)) {
    t.skip("Microsoft Edge is not available in this environment");
    return;
  }
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    t.skip("Playwright is not available in this environment");
    return;
  }

  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true, executablePath: edgePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify([{ id: "alipay", name: "支付宝", openingBalance: 100 }]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.setInputFiles("#fileInput", {
      name: "alipay-balance.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "支付宝支付科技有限公司 交易流水证明\n" +
          "收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间\n" +
          "支出 星巴克 星巴克咖啡 支付宝余额 32.50 20260301220014662214274 A0001 2026-03-01 09:30:00",
      ),
    });
    await page.click("#importButton");
    await page.waitForSelector("#pendingRows tr");
    await page.selectOption("#importAccountInput", "alipay");
    await page.click("#confirmImportButton");
    await page.waitForFunction(() =>
      (document.querySelector("#importStatus")?.textContent || "").includes("已入账"),
    );
    await page.selectOption("#accountFilterInput", "alipay");

    assert.equal(await page.locator("#transactionRows tr").count(), 1);
    assert.match(await page.locator("#transactionRows tr").first().textContent(), /星巴克/u);
    assert.match(await page.locator("#transactionRows tr").first().textContent(), /¥67\.50/u);
  } finally {
    await browser.close();
    await server.close();
  }
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-name-pattern "Alipay" tests\legacy-browser-smoke.test.mjs
```

Expected: at least unmatched-card warning fails until notice rendering is complete.

- [ ] **Step 3: Render notices consistently**

Update `renderDetectedAccountPanel` to treat pending import notices as display-worthy even without pending transactions:

```js
const pendingNotices = state.pendingImportNotices || [];
const hasNotice = Boolean((state.pendingAccountNotice || pendingNotices.length > 0) && (hasPendingImportItems() || pendingNotices.length > 0));
```

When there are notices:

```js
elements.detectedAccountTitle.textContent = "导入提示";
elements.detectedAccountDetail.textContent = [state.pendingAccountNotice, ...pendingNotices]
  .filter(Boolean)
  .join("；");
elements.addDetectedAccountControl.classList.add("is-hidden");
return;
```

Add `formatAlipaySkippedNotice(item)`:

```js
function formatAlipaySkippedNotice(item) {
  if (item?.skipReason === "zero-or-neutral") {
    return `已跳过不计收支或零金额记录：${item.description || item.paymentMethod || "支付宝记录"}`;
  }
  return `已跳过支付宝记录：${item?.description || item?.paymentMethod || "未支持付款方式"}`;
}
```

- [ ] **Step 4: Ensure true Alipay rows keep selector fallback**

In `importSelectedFile`, only resolve `accountCandidate` for non-Alipay statement modes. If `result.reconciliationItems` exists and `result.accountCandidate` is null, set `pendingAccountNotice` only when there are true new transactions and no selected account.

The selected `#importAccountInput` continues to control `state.pendingTransactions`, but not bank-card reconciliation items.

- [ ] **Step 5: Run targeted browser tests**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test --test-name-pattern "Alipay" tests\legacy-browser-smoke.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add assets\app.js tests\legacy-browser-smoke.test.mjs
git commit -m "Handle Alipay import skips and balance rows"
```

---

### Task 4: Regression, Real Statement Check, Cache Bump, And Review

**Files:**
- Modify: `service-worker.js`
- Optional modify: tests if real-statement validation exposes a parser gap

**Interfaces:**
- Consumes: all prior tasks.
- Produces: deployable `v23` app shell.

- [ ] **Step 1: Bump service worker cache**

Change:

```js
const CACHE_NAME = "ai-caiduo-v22";
```

to:

```js
const CACHE_NAME = "ai-caiduo-v23";
```

- [ ] **Step 2: Run unit and browser regression**

Run:

```powershell
$env:NODE_PATH='C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules;C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\.pnpm\node_modules'
& 'C:\Users\47215\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test tests\*.mjs
git diff --check
```

Expected: all tests pass, diff check exits 0.

- [ ] **Step 3: Validate the provided Alipay PDF manually**

Use the real file:

```text
C:\Users\47215\OneDrive\Desktop\支付宝交易明细(20260201-20260331).pdf
```

Expected behavior:

- The file is recognized as an Alipay statement.
- Rows paid by `招商银行信用卡(1755)` do not create Alipay transactions.
- If local account `招商银行信用卡 尾号1755` exists and matching transactions exist, preview shows rows that will supplement existing transactions.
- If that account or matching transactions do not exist, the app shows skip warnings and does not add rows.
- The statement does not create Alipay balance rows because no effective Alipay-balance payment rows were observed.

- [ ] **Step 4: Commit cache and any final test adjustments**

```powershell
git add service-worker.js
git commit -m "Refresh cache for Alipay import handling"
```

If Task 4 required parser or test adjustments, include those touched files in the same commit with the same message.

- [ ] **Step 5: Request code review**

Use `superpowers:requesting-code-review` with:

- Description: Alipay payment-method import, bank-card reconciliation, description annotation, skip warnings, Alipay balance rows.
- Base SHA: `a28e655`
- Head SHA: current `HEAD`.
- Requirements: `docs/superpowers/specs/2026-07-20-alipay-payment-method-import-design.md`.

- [ ] **Step 6: Merge, push, and verify online**

After review is clean:

```powershell
git -C C:\Users\47215\OneDrive\文件\个人记账app\ai-caiduo-pages merge --ff-only codex/alipay-payment-method-import
git -C C:\Users\47215\OneDrive\文件\个人记账app\ai-caiduo-pages push origin master
```

Poll:

```text
https://rrrot507.github.io/ai-caiduo-pages/service-worker.js
```

Expected: contains `ai-caiduo-v23`.

Run an online Playwright smoke check against:

```text
https://rrrot507.github.io/ai-caiduo-pages/
```

Verify:

- A matched bank-card Alipay row updates an existing transaction description.
- An unmatched bank-card row shows a warning and creates no transaction.
- A true Alipay-balance row creates a transaction under the Alipay account.

---

## Self-Review

- Spec coverage: parser, payment method classification, bank-card matching, no duplicate import, description supplement, category assistance, true Alipay rows, skip warnings, tests, and cache bump are each covered.
- Unfinished-marker scan: no unfinished markers remain.
- Type consistency: `reconciliationItems`, `pendingTransactionUpdates`, `pendingImportNotices`, `paymentAccountCandidate`, `accountFingerprint`, and `accountNumberLast4` are used consistently across tasks.
