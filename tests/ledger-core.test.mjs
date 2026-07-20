import test from "node:test";
import assert from "node:assert/strict";

import {
  UNASSIGNED_ACCOUNT_ID,
  buildMerchantCategoryHistory,
  calculateRunningBalances,
  compareLedgerTransactionsDescending,
  filterLedgerTransactions,
  getCategoriesForType,
  getTransactionType,
  getTransactionTypes,
  inferCategory,
  normalizeTransactionCategory,
  parseLedgerText,
  recommendCategory,
  summarizeMonth,
  summarizeSelection,
  tagTransferTransactions,
  toCsv,
} from "../assets/ledger-core.mjs";

test("provides scenario-specific category options for each transaction type", () => {
  assert.deepEqual(getCategoriesForType("expense"), [
    "餐饮",
    "交通",
    "购物",
    "居家",
    "医疗",
    "娱乐",
    "学习",
    "其他支出",
  ]);
  assert.deepEqual(getCategoriesForType("income"), [
    "工资",
    "奖金",
    "报销",
    "退款",
    "利息",
    "投资收益",
    "其他收入",
  ]);
  assert.deepEqual(getCategoriesForType("transfer"), ["转账"]);
  assert.deepEqual(getCategoriesForType("refunded"), ["已退款"]);
});

test("provides ordered transaction type options", () => {
  assert.deepEqual(getTransactionTypes(), [
    { value: "expense", label: "支出" },
    { value: "income", label: "收入" },
    { value: "transfer", label: "转账" },
    { value: "refunded", label: "已退款" },
  ]);
});

test("normalizes categories so they match the transaction type", () => {
  assert.equal(normalizeTransactionCategory("收入", "expense", "未知商户"), "其他支出");
  assert.equal(normalizeTransactionCategory("餐饮", "income", "工资入账"), "工资");
  assert.equal(normalizeTransactionCategory("其他", "income", "未知收入"), "其他收入");
  assert.equal(normalizeTransactionCategory("收入", "transfer", "账户互转"), "转账");
  assert.equal(normalizeTransactionCategory("餐饮", "refunded", "退款配对"), "已退款");
});

test("recommends categories with source and confidence without guessing", () => {
  assert.deepEqual(recommendCategory("财付通-虎头军煎饼（鼎成中心店）", "expense"), {
    category: "餐饮",
    confidence: "high",
    source: "rule",
    merchant: "虎头军煎饼",
  });
  assert.deepEqual(recommendCategory("财付通-PIZZAHUT", "expense"), {
    category: "餐饮",
    confidence: "high",
    source: "rule",
    merchant: "PIZZAHUT",
  });
  assert.equal(recommendCategory("KFC", "expense").category, "餐饮");
  assert.equal(recommendCategory("Pizza Hut", "expense").category, "餐饮");
  assert.equal(recommendCategory("kfc", "expense").category, "餐饮");
  assert.equal(recommendCategory("麦当劳", "expense").category, "餐饮");
  assert.deepEqual(recommendCategory("支付宝-未知商户服务", "expense"), {
    category: "其他支出",
    confidence: "low",
    source: "fallback",
    merchant: "未知商户服务",
  });
  assert.deepEqual(recommendCategory("茶几购买", "expense"), {
    category: "其他支出",
    confidence: "low",
    source: "fallback",
    merchant: "茶几购买",
  });
  assert.deepEqual(recommendCategory("书包", "expense"), {
    category: "其他支出",
    confidence: "low",
    source: "fallback",
    merchant: "书包",
  });
  assert.deepEqual(recommendCategory("朝朝宝转出", "income"), {
    category: "利息",
    confidence: "high",
    source: "rule",
    merchant: "朝朝宝转出",
  });
  assert.deepEqual(recommendCategory("账户互转", "transfer"), {
    category: "转账",
    confidence: "high",
    source: "transfer",
    merchant: "账户互转",
  });
});

test("learns merchant category recommendations from saved user transactions", () => {
  const history = buildMerchantCategoryHistory([
    {
      description: "美团-常去面馆",
      direction: "expense",
      category: "餐饮",
    },
    {
      description: "微信支付-常去面馆",
      direction: "expense",
      category: "餐饮",
    },
    {
      description: "支付宝-常去面馆",
      direction: "expense",
      category: "其他支出",
    },
    {
      description: "微信支付-不稳定商户",
      direction: "expense",
      category: "餐饮",
    },
    {
      description: "财付通-不稳定商户",
      direction: "expense",
      category: "餐饮",
    },
    {
      description: "支付宝-不稳定商户",
      direction: "expense",
      category: "购物",
    },
    {
      description: "账户互转",
      direction: "expense",
      type: "transfer",
      category: "转账",
    },
  ]);

  assert.deepEqual(recommendCategory("财付通-常去面馆", { type: "expense", history }), {
    category: "餐饮",
    confidence: "high",
    source: "user-history",
    merchant: "常去面馆",
  });
  assert.deepEqual(recommendCategory("财付通-不稳定商户", { type: "expense", history }), {
    category: "其他支出",
    confidence: "low",
    source: "fallback",
    merchant: "不稳定商户",
  });
});

test("preserves explicit transfer rows while removing stale auto transfer tags", () => {
  const transactions = tagTransferTransactions([
    {
      id: "ai-transfer",
      date: "2026-07-07",
      description: "账户互转",
      amount: -200,
      direction: "expense",
      type: "transfer",
      transferMatch: "explicit",
      category: "收入",
      accountId: "checking",
    },
    {
      id: "stale-auto-transfer",
      date: "2026-07-08",
      description: "旧自动转账",
      amount: -50,
      direction: "expense",
      type: "transfer",
      transferMatch: "auto",
      category: "转账",
      accountId: "checking",
    },
    {
      id: "legacy-stale-transfer",
      date: "2026-07-09",
      description: "旧转账标签",
      amount: -30,
      direction: "expense",
      type: "transfer",
      category: "转账",
      accountId: "checking",
    },
  ]);

  assert.deepEqual(
    transactions.map(({ id, type, transferMatch, category }) => ({
      id,
      type,
      transferMatch,
      category,
    })),
    [
      {
        id: "ai-transfer",
        type: "transfer",
        transferMatch: "explicit",
        category: "转账",
      },
      {
        id: "stale-auto-transfer",
        type: undefined,
        transferMatch: undefined,
        category: "其他支出",
      },
      {
        id: "legacy-stale-transfer",
        type: undefined,
        transferMatch: undefined,
        category: "其他支出",
      },
    ],
  );
});

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
      category: "工资",
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

test("exports transfer transactions with transfer type label", () => {
  const csv = toCsv([
    {
      date: "2026-03-06",
      description: "账户互转",
      amount: -100,
      direction: "expense",
      type: "transfer",
      category: "其他",
      source: "file",
    },
  ]);

  assert.equal(
    csv,
    "日期,账户,类型,分类,说明,金额,来源\n2026-03-06,未指定账户,转账,转账,账户互转,-100.00,file",
  );
});

test("infers a conservative fallback category", () => {
  assert.equal(inferCategory("未知商户"), "其他支出");
  assert.equal(inferCategory("工资入账", "income"), "工资");
  assert.equal(inferCategory("账户互转", "transfer"), "转账");
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

test("tags same-day equal opposite account movements as transfers and excludes them from cash flow totals", () => {
  const transactions = tagTransferTransactions([
    {
      id: "savings-payment",
      date: "2026-03-06",
      amount: -30435.91,
      direction: "expense",
      category: "其他",
      accountId: "cmb-savings-3598",
      sequence: 1,
    },
    {
      id: "credit-repayment",
      date: "2026-03-06",
      amount: 30435.91,
      direction: "income",
      category: "收入",
      accountId: "cmb-credit-1755",
      sequence: 2,
    },
    {
      id: "salary",
      date: "2026-03-06",
      amount: 1000,
      direction: "income",
      category: "收入",
      accountId: "cmb-savings-3598",
      sequence: 3,
    },
    {
      id: "coffee",
      date: "2026-03-06",
      amount: -20,
      direction: "expense",
      category: "餐饮",
      accountId: "cmb-savings-3598",
      sequence: 4,
    },
  ]);

  assert.equal(transactions.find((transaction) => transaction.id === "savings-payment").type, "transfer");
  assert.equal(transactions.find((transaction) => transaction.id === "credit-repayment").type, "transfer");
  assert.equal(transactions.find((transaction) => transaction.id === "salary").type, undefined);

  const summary = summarizeSelection(transactions, {
    startDate: "2026-03-06",
    endDate: "2026-03-06",
  });

  assert.equal(summary.income, 1000);
  assert.equal(summary.expense, 20);
  assert.equal(summary.balance, 980);
  assert.equal(summary.count, 4);
  assert.deepEqual(summary.categoryTotals, [{ category: "餐饮", amount: 20 }]);
});

test("tags same-day same-account opposite merchant rows as refunded and excludes them from cash flow totals", () => {
  const transactions = tagTransferTransactions([
    {
      id: "hutoujun-refund",
      date: "2026-03-02",
      description: "财付通-虎头军煎饼（鼎成中心店）",
      amount: 14,
      direction: "income",
      category: "退款",
      accountId: "cmb-savings-3598",
      sequence: 1,
    },
    {
      id: "hutoujun-payment",
      date: "2026-03-02",
      description: "财付通-虎头军煎饼（鼎成中心店）",
      amount: -14,
      direction: "expense",
      category: "餐饮",
      accountId: "cmb-savings-3598",
      sequence: 2,
    },
    {
      id: "salary",
      date: "2026-03-02",
      description: "工资",
      amount: 1000,
      direction: "income",
      category: "工资",
      accountId: "cmb-savings-3598",
      sequence: 3,
    },
    {
      id: "pizza",
      date: "2026-03-03",
      description: "财付通-PIZZAHUT",
      amount: -37,
      direction: "expense",
      category: "餐饮",
      accountId: "cmb-savings-3598",
      sequence: 4,
    },
  ]);

  assert.equal(getTransactionType(transactions.find((transaction) => transaction.id === "hutoujun-refund")), "refunded");
  assert.equal(getTransactionType(transactions.find((transaction) => transaction.id === "hutoujun-payment")), "refunded");
  assert.equal(transactions.find((transaction) => transaction.id === "hutoujun-refund").category, "已退款");
  assert.equal(transactions.find((transaction) => transaction.id === "hutoujun-payment").category, "已退款");

  const summary = summarizeSelection(transactions, {
    startDate: "2026-03-02",
    endDate: "2026-03-03",
  });

  assert.equal(summary.income, 1000);
  assert.equal(summary.expense, 37);
  assert.equal(summary.balance, 963);
  assert.equal(summary.count, 4);
  assert.deepEqual(summary.categoryTotals, [{ category: "餐饮", amount: 37 }]);
});

test("prioritizes strict refund pairs over unrelated same-amount transfer candidates", () => {
  const transactions = tagTransferTransactions([
    {
      id: "unrelated-income",
      date: "2026-03-02",
      description: "账户调整",
      amount: 14,
      direction: "income",
      category: "其他收入",
      accountId: "credit",
      sequence: 1,
    },
    {
      id: "hutoujun-refund",
      date: "2026-03-02",
      description: "财付通-虎头军煎饼（鼎成中心店）",
      amount: 14,
      direction: "income",
      category: "退款",
      accountId: "checking",
      sequence: 2,
    },
    {
      id: "hutoujun-payment",
      date: "2026-03-02",
      description: "财付通-虎头军煎饼（鼎成中心店）",
      amount: -14,
      direction: "expense",
      category: "餐饮",
      accountId: "checking",
      sequence: 3,
    },
  ]);

  assert.equal(getTransactionType(transactions.find((transaction) => transaction.id === "hutoujun-refund")), "refunded");
  assert.equal(getTransactionType(transactions.find((transaction) => transaction.id === "hutoujun-payment")), "refunded");
  assert.equal(getTransactionType(transactions.find((transaction) => transaction.id === "unrelated-income")), "income");

  const summary = summarizeSelection(transactions, {
    startDate: "2026-03-02",
    endDate: "2026-03-02",
  });

  assert.equal(summary.income, 14);
  assert.equal(summary.expense, 0);
  assert.equal(summary.balance, 14);
});

test("removes stale transfer tags when the matching opposite transaction is gone", () => {
  const transactions = tagTransferTransactions([
    {
      id: "stale-payment",
      date: "2026-03-06",
      amount: -30435.91,
      direction: "expense",
      category: "其他",
      accountId: "cmb-savings-3598",
      type: "transfer",
    },
  ]);

  assert.equal(transactions[0].type, undefined);
});

test("does not tag unassigned transactions as transfers", () => {
  const transactions = tagTransferTransactions([
    {
      id: "unassigned-payment",
      date: "2026-03-06",
      amount: -100,
      direction: "expense",
      category: "其他",
      accountId: UNASSIGNED_ACCOUNT_ID,
    },
    {
      id: "assigned-income",
      date: "2026-03-06",
      amount: 100,
      direction: "income",
      category: "收入",
      accountId: "bank-card",
    },
  ]);

  assert.equal(transactions[0].type, undefined);
  assert.equal(transactions[1].type, undefined);
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
    "日期,账户,类型,分类,说明,金额,来源\n2026-07-02,招商信用卡,支出,餐饮,\"午餐,咖啡\",-45.60,manual\n2026-07-03,未指定账户,支出,其他支出,旧数据,-8.00,manual",
  );
});
