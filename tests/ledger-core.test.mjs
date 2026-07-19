import test from "node:test";
import assert from "node:assert/strict";

import {
  UNASSIGNED_ACCOUNT_ID,
  calculateRunningBalances,
  compareLedgerTransactionsDescending,
  filterLedgerTransactions,
  inferCategory,
  parseLedgerText,
  summarizeMonth,
  summarizeSelection,
  toCsv,
} from "../assets/ledger-core.mjs";

test("parses pasted statement text into normalized transactions", () => {
  const transactions = parseLedgerText(
    `
    交易日期 摘要 金额
    2026-07-02 星巴克咖啡 -32.50
    2026/07/03 工资入账 12000.00 收入
    07-04 滴滴出行 支出 48.20
    本页小计 12015.70
    `,
    { fallbackYear: 2026 },
  );

  assert.deepEqual(transactions, [
    {
      date: "2026-07-02",
      description: "星巴克咖啡",
      amount: -32.5,
      direction: "expense",
      category: "餐饮",
      source: "paste",
    },
    {
      date: "2026-07-03",
      description: "工资入账",
      amount: 12000,
      direction: "income",
      category: "收入",
      source: "paste",
    },
    {
      date: "2026-07-04",
      description: "滴滴出行",
      amount: -48.2,
      direction: "expense",
      category: "交通",
      source: "paste",
    },
  ]);
});

test("ignores statement date ranges when parsing ledger text", () => {
  const transactions = parseLedgerText(
    `
    账单周期 2026.1.1-2026.1.31
    统计期间 2026.1.1 至 2026年1月31日 支出合计
    2026.1.1 2026 年账单
    `,
    { fallbackYear: 2026 },
  );

  assert.deepEqual(transactions, []);
});

test("parses ledger rows with transaction and posting dates", () => {
  const transactions = parseLedgerText(
    `
    03/01 03/02 星巴克咖啡 -32.50
    2026-01-01 2026-01-02 地铁出行 支出 6.00
    `,
    { fallbackYear: 2026 },
  );

  assert.deepEqual(transactions, [
    {
      date: "2026-03-01",
      description: "星巴克咖啡",
      amount: -32.5,
      direction: "expense",
      category: "餐饮",
      source: "paste",
    },
    {
      date: "2026-01-01",
      description: "地铁出行",
      amount: -6,
      direction: "expense",
      category: "交通",
      source: "paste",
    },
  ]);
});

test("summarizes one month with positive expense totals", () => {
  const summary = summarizeMonth(
    [
      { date: "2026-07-02", amount: -32.5, category: "餐饮" },
      { date: "2026-07-03", amount: 12000, category: "收入" },
      { date: "2026-07-04", amount: -48.2, category: "交通" },
      { date: "2026-06-29", amount: -100, category: "购物" },
    ],
    "2026-07",
  );

  assert.equal(summary.income, 12000);
  assert.equal(summary.expense, 80.7);
  assert.equal(summary.balance, 11919.3);
  assert.equal(summary.count, 3);
  assert.deepEqual(summary.categoryTotals, [
    { category: "交通", amount: 48.2 },
    { category: "餐饮", amount: 32.5 },
  ]);
});

test("exports csv with escaped fields", () => {
  const csv = toCsv([
    {
      date: "2026-07-02",
      description: "午餐,咖啡",
      amount: -45.6,
      direction: "expense",
      category: "餐饮",
      source: "manual",
    },
  ]);

  assert.equal(
    csv,
    "日期,账户,类型,分类,说明,金额,来源\n2026-07-02,未指定账户,支出,餐饮,\"午餐,咖啡\",-45.60,manual",
  );
});

test("infers a conservative fallback category", () => {
  assert.equal(inferCategory("未知商户"), "其他");
});

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

test("rejects impossible dates when filtering by date range", () => {
  const transactions = filterLedgerTransactions(
    [
      { date: "2026-02-28", amount: -10, category: "餐饮", accountId: "cmb" },
      { date: "2026-02-00", amount: -15, category: "餐饮", accountId: "cmb" },
      { date: "2026-02-31", amount: -20, category: "餐饮", accountId: "cmb" },
      { date: "2026-13-01", amount: -30, category: "餐饮", accountId: "cmb" },
    ],
    { startDate: "2026-02-01", endDate: "2026-02-28", accountIds: ["cmb"] },
  );

  assert.deepEqual(transactions, [
    { date: "2026-02-28", amount: -10, category: "餐饮", accountId: "cmb" },
  ]);
});

test("does not parse impossible calendar dates", () => {
  const transactions = parseLedgerText(
    `
    2026-02-31 无效日期 -10.00
    2026-13-01 无效月份 -20.00
    2026-02-28 有效日期 -30.00
    `,
    { fallbackYear: 2026 },
  );

  assert.deepEqual(transactions.map((transaction) => transaction.date), ["2026-02-28"]);
});

test("calculates running balances by account from opening balances", () => {
  const result = calculateRunningBalances(
    [
      {
        id: "later",
        date: "2026-07-03",
        createdAt: "2026-07-03T09:00:00Z",
        amount: 50,
        accountId: "cmb",
      },
      {
        id: "first",
        date: "2026-07-01",
        createdAt: "2026-07-01T09:00:00Z",
        amount: -20,
        accountId: "cmb",
      },
      {
        id: "wechat",
        date: "2026-07-02",
        createdAt: "2026-07-02T09:00:00Z",
        amount: -5,
        accountId: "wechat",
      },
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

test("orders same-day running balances by transaction sequence", () => {
  const transactions = [
    { id: "first", date: "2026-07-01", amount: -32.5, accountId: "cmb", sequence: 1 },
    { id: "second", date: "2026-07-01", amount: 10, accountId: "cmb", sequence: 2 },
    { id: "third", date: "2026-07-01", amount: -5, accountId: "cmb", sequence: 3 },
  ];
  const result = calculateRunningBalances(transactions, {
    openingBalanceByAccountId: { cmb: 100 },
  });
  const newestFirst = [...transactions].sort(compareLedgerTransactionsDescending);

  assert.deepEqual(newestFirst.map((transaction) => transaction.id), [
    "third",
    "second",
    "first",
  ]);
  assert.equal(result.transactionBalances.get("first"), 67.5);
  assert.equal(result.transactionBalances.get("second"), 77.5);
  assert.equal(result.transactionBalances.get("third"), 72.5);
  assert.equal(
    result.transactionBalances.get("second") + newestFirst[0].amount,
    result.transactionBalances.get("third"),
  );
  assert.equal(
    result.transactionBalances.get("first") + newestFirst[1].amount,
    result.transactionBalances.get("second"),
  );
});

test("orders same-day balances by creation time before sequence across batches", () => {
  const transactions = [
    {
      id: "older-batch",
      date: "2026-07-01",
      createdAt: "2026-07-01T09:00:00Z",
      amount: -5,
      accountId: "cmb",
      sequence: 100,
    },
    {
      id: "newer-batch",
      date: "2026-07-01",
      createdAt: "2026-07-02T09:00:00Z",
      amount: 10,
      accountId: "cmb",
      sequence: 1,
    },
  ];
  const result = calculateRunningBalances(transactions, {
    openingBalanceByAccountId: { cmb: 100 },
  });
  const newestFirst = [...transactions].sort(compareLedgerTransactionsDescending);

  assert.deepEqual(newestFirst.map((transaction) => transaction.id), [
    "newer-batch",
    "older-batch",
  ]);
  assert.equal(result.transactionBalances.get("older-batch"), 95);
  assert.equal(result.transactionBalances.get("newer-batch"), 105);
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
