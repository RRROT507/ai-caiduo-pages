import test from "node:test";
import assert from "node:assert/strict";

import {
  inferCategory,
  parseLedgerText,
  summarizeMonth,
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
    "日期,类型,分类,说明,金额,来源\n2026-07-02,支出,餐饮,\"午餐,咖啡\",-45.60,manual",
  );
});

test("infers a conservative fallback category", () => {
  assert.equal(inferCategory("未知商户"), "其他");
});
