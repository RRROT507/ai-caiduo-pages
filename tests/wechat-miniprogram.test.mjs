import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..");
const miniprogramRoot = join(root, "miniprogram");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("provides a WeChat miniprogram project that can be opened in developer tools", () => {
  const projectConfig = readJson(join(miniprogramRoot, "project.config.json"));
  const appConfig = readJson(join(miniprogramRoot, "app.json"));

  assert.equal(projectConfig.compileType, "miniprogram");
  assert.equal(projectConfig.appid, "wxce03f2b9e6bffd6e");
  assert.equal(projectConfig.projectname, "AI财舵");
  assert.equal(projectConfig.miniprogramRoot, "./");
  assert.equal(appConfig.window.navigationBarTitleText, "AI财舵");
  assert.deepEqual(appConfig.pages, [
    "pages/index/index",
    "pages/records/records",
    "pages/accounts/accounts",
    "pages/import/import",
  ]);

  for (const page of appConfig.pages) {
    for (const extension of ["js", "json", "wxml", "wxss"]) {
      assert.equal(
        existsSync(join(miniprogramRoot, `${page}.${extension}`)),
        true,
        `${page}.${extension} should exist`,
      );
    }
  }
});

test("ships a native miniprogram shell instead of wrapping the hosted web app", () => {
  const appConfig = readJson(join(miniprogramRoot, "app.json"));
  const importMarkup = readFileSync(join(miniprogramRoot, "pages/import/import.wxml"), "utf8");
  const indexMarkup = readFileSync(join(miniprogramRoot, "pages/index/index.wxml"), "utf8");

  assert.equal(importMarkup.includes("<web-view"), false);
  assert.equal(indexMarkup.includes("/miniprogram/pages/"), false);
  assert.equal(appConfig.pages.includes("pages/import/import"), true);
});

test("supports core ledger behavior inside the miniprogram runtime", () => {
  const core = require("../miniprogram/utils/ledger-core.js");
  const transactions = [
    {
      id: "salary",
      date: "2026-03-10",
      amount: 8000,
      direction: "income",
      category: "工资",
      accountId: "cmb",
    },
    {
      id: "meal",
      date: "2026-03-11",
      amount: -37,
      direction: "expense",
      category: "",
      description: "财付通-PIZZAHUT",
      accountId: "cmb",
    },
    {
      id: "transfer-out",
      date: "2026-03-12",
      amount: -1000,
      direction: "expense",
      type: "transfer",
      accountId: "cmb",
    },
    {
      id: "transfer-in",
      date: "2026-03-12",
      amount: 1000,
      direction: "income",
      type: "transfer",
      accountId: "alipay",
    },
  ];

  assert.deepEqual(core.getCategoriesForType("expense"), [
    "餐饮",
    "交通",
    "购物",
    "居家",
    "医疗",
    "娱乐",
    "学习",
    "其他支出",
  ]);
  assert.equal(core.recommendCategory("财付通-PIZZAHUT", "expense").category, "餐饮");

  const summary = core.summarizeSelection(transactions, {
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    accountId: "all",
  });
  assert.equal(summary.income, 8000);
  assert.equal(summary.expense, 37);
  assert.equal(summary.balance, 7963);

  const balances = core.calculateRunningBalances(transactions, {
    openingBalanceByAccountId: { cmb: 100, alipay: 20 },
  });
  assert.equal(balances.transactionBalances.get("meal"), 8063);
  assert.equal(balances.transactionBalances.get("transfer-out"), 7063);
  assert.equal(balances.transactionBalances.get("transfer-in"), 1020);
});
