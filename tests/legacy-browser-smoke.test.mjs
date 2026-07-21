import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
let nextStaticServerPort = 43100;

test("uploads a statement file and confirms recognized transactions", async (t) => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await page.addInitScript(() => {
      delete Element.prototype.replaceChildren;

      const RealDate = Date;
      const frozenTime = new RealDate("2026-07-19T12:00:00.000Z").valueOf();
      class FrozenDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [frozenTime]));
        }

        static now() {
          return frozenTime;
        }
      }
      globalThis.Date = FrozenDate;
    });

    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.fill("#accountNameInput", "储蓄卡");
    await page.fill("#accountOpeningBalanceInput", "1000");
    await page.click("#accountForm button[type=submit]");
    await page.waitForTimeout(100);

    assert.ok(
      await page.locator('#accountList input[value="招商信用卡"]').isVisible(),
    );
    assert.ok(await page.locator('#accountList input[value="储蓄卡"]').isVisible());
    assert.equal(
      await page.locator("#accountInput option").filter({ hasText: "储蓄卡" }).count(),
      1,
    );
    assert.equal(
      await page.locator("#importAccountInput option").filter({ hasText: "储蓄卡" }).count(),
      1,
    );
    assert.equal(await page.locator("#accountList input[data-account-opening-id]").count(), 5);

    assert.equal(await page.locator("#monthFilterList").count(), 0);
    assert.equal(await page.locator("#accountFilterList").count(), 0);
    await page.click("#dateRangeButton");
    await page.click('[data-date-value="2026-07-02"]');
    await page.click('[data-date-value="2026-07-02"]');
    await page.selectOption("#accountFilterInput", "all");

    const savingsAccountValue = await page
      .locator("#accountInput option")
      .filter({ hasText: "储蓄卡" })
      .getAttribute("value");
    await page.selectOption("#accountInput", savingsAccountValue);
    await page.fill("#dateInput", "2026-07-02");
    await page.selectOption("#directionInput", "expense");
    await page.fill("#amountInput", "32.50");
    await page.fill("#descriptionInput", "星巴克咖啡");
    await page.click("#entryForm button[type=submit]");
    assert.match(await page.locator("#transactionRows tr").first().textContent(), /¥967\.50/u);

    await page.selectOption("#accountInput", savingsAccountValue);
    await page.fill("#dateInput", "2026-07-02");
    await page.selectOption("#directionInput", "income");
    await page.fill("#amountInput", "10.00");
    await page.fill("#descriptionInput", "同日退款");
    await page.click("#entryForm button[type=submit]");
    const sameDayRows = await page.locator("#transactionRows tr").allTextContents();
    assert.match(sameDayRows[0], /同日退款/u);
    assert.match(sameDayRows[0], /\+¥10\.00/u);
    assert.match(sameDayRows[0], /¥977\.50/u);
    assert.match(sameDayRows[1], /星巴克咖啡/u);
    assert.match(sameDayRows[1], /-¥32\.50/u);
    assert.match(sameDayRows[1], /¥967\.50/u);

    await page.selectOption("#accountInput", "wechat");
    await page.fill("#dateInput", "2026-08-03");
    await page.selectOption("#directionInput", "income");
    await page.fill("#amountInput", "12000");
    await page.fill("#descriptionInput", "工资入账");
    await page.click("#entryForm button[type=submit]");

    await page.click("#dateRangeButton");
    await page.click('[data-date-value="2026-07-02"]');
    await page.click("#nextCalendarMonthButton");
    await page.click('[data-date-value="2026-08-03"]');
    assert.equal(await page.locator("#transactionRows tr").count(), 3);
    assert.equal(await page.locator("#transactionCount").textContent(), "3");

    const committedRangeLabel = await page.locator("#dateRangeLabel").textContent();
    await page.click("#dateRangeButton");
    await page.click("#nextCalendarMonthButton");
    await page.click('[data-date-value="2026-08-03"]');
    assert.equal(await page.locator("#dateRangeLabel").textContent(), committedRangeLabel);
    assert.equal(await page.locator("#transactionCount").textContent(), "3");
    assert.equal(await page.locator("#dateRangePanel").getAttribute("class"), "date-range-panel");

    await page.click("#dateRangeButton");
    await page.click("#dateRangeButton");
    await page.click('[data-date-value="2026-07-02"]');
    assert.equal(await page.locator("#dateRangeLabel").textContent(), committedRangeLabel);
    assert.equal(await page.locator("#transactionCount").textContent(), "3");
    assert.equal(await page.locator("#dateRangePanel").getAttribute("class"), "date-range-panel");
    await page.click("#nextCalendarMonthButton");
    await page.click('[data-date-value="2026-08-03"]');
    assert.equal(await page.locator("#dateRangePanel").getAttribute("class"), "date-range-panel is-hidden");

    await page.selectOption("#accountFilterInput", "wechat");
    assert.equal(await page.locator("#transactionRows tr").count(), 1);
    assert.ok(await page.locator("#transactionRows").getByText("微信").isVisible());
    assert.equal(await page.locator("#transactionCount").textContent(), "1");

    await page.selectOption("#accountFilterInput", "all");

    await page.setInputFiles("#fileInput", {
      name: "cmb-statement.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`2026-07-02 星巴克咖啡 -32.50
2026/07/03 工资入账 12000.00 收入
07-04 滴滴出行 支出 48.20
2026-07-05 超市购物 -168.90`),
    });
    await page.click("#importButton");
    await page.waitForTimeout(300);

    assert.equal(errors.join(" | "), "");
    assert.ok((await page.locator("#categoryInput option").count()) > 0);
    assert.equal(await page.locator("#pendingRows tr").count(), 4);
    assert.ok(await page.locator("#detectedAccountPanel").isVisible());
    assert.match(await page.locator("#detectedAccountPanel").textContent(), /未识别到账户/u);
    assert.match(await page.locator("#detectedAccountPanel").textContent(), /手动选择入账账户/u);
    assert.equal(await page.locator("#transactionRows tr").count(), 3);
    await page.click("#confirmImportButton");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#transactionRows tr").count(), 7);

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

    await page.setInputFiles("#fileInput", {
      name: "cmb-matched-account-statement.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`招商银行交易流水
Transaction Statement of China Merchants Bank
卡 账号：6214850121113598
交易日期 币种 交易金额 账户余额 交易摘要 交易对方信息
2026-07-06 CNY 42.00 3,958.00 手动改选账户`),
    });
    await page.click("#importButton");
    await page.waitForTimeout(300);
    assert.match(
      await page.locator("#detectedAccountPanel").textContent(),
      /已匹配账户：招商银行 尾号3598/u,
    );
    await page.selectOption("#importAccountInput", "alipay");
    await page.click("#confirmImportButton");
    await page.waitForTimeout(300);

    await page.selectOption("#accountFilterInput", "alipay");
    const manuallyReassignedRows = await page.locator("#transactionRows tr").allTextContents();
    assert.equal(manuallyReassignedRows.length, 1);
    assert.match(manuallyReassignedRows[0], /手动改选账户/u);
    await page.selectOption("#accountFilterInput", "all");

    await page.selectOption("#importAccountInput", "alipay");
    await page.setInputFiles("#fileInput", {
      name: "alipay-statement.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("2026-07-05 支付宝-高德打车 -10.30"),
    });
    await page.click("#importButton");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#pendingRows tr").count(), 1);
    await page.click("#confirmImportButton");
    await page.waitForTimeout(300);

    await page.selectOption("#accountFilterInput", "alipay");
    const alipayRows = await page.locator("#transactionRows tr").allTextContents();
    assert.equal(alipayRows.length, 2);
    assert.match(alipayRows.join("\n"), /手动改选账户/u);
    assert.match(alipayRows.join("\n"), /支付宝/u);
    assert.match(alipayRows.join("\n"), /高德打车/u);

    await page.setInputFiles("#fileInput", {
      name: "cmb-new-account-manual-override.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`Transaction Statement of China Merchants Bank
Account No: 214850121117777
Transaction Date Currency Amount Balance Description
2026-07-07 CNY 25.00 125.00 Manual new-account override`),
    });
    await page.click("#importButton");
    await page.waitForTimeout(300);
    assert.match(await page.locator("#detectedAccountPanel").textContent(), /7777/u);
    assert.ok(await page.locator("#addDetectedAccountInput").isChecked());
    await page.selectOption("#importAccountInput", "alipay");
    assert.equal(await page.locator("#addDetectedAccountInput").isChecked(), false);
    await page.click("#confirmImportButton");
    await page.waitForTimeout(300);

    assert.equal(
      await page.locator("#accountList input[value='招商银行 尾号7777']").count(),
      0,
    );
    await page.selectOption("#accountFilterInput", "alipay");
    const manuallyOverriddenNewAccountRows = await page.locator("#transactionRows tr").allTextContents();
    assert.equal(manuallyOverriddenNewAccountRows.length, 3);
    assert.match(manuallyOverriddenNewAccountRows.join("\n"), /Manual new-account override/u);

    await page.evaluate(() => {
      const accounts = JSON.parse(localStorage.getItem("ai-caiduo-accounts-v1"));
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify(
          accounts.map((account) =>
            account.id === "cmb-credit-card"
              ? {
                  ...account,
                  name: "招商银行信用卡 尾号1755",
                  institution: "招商银行",
                  accountNumberLast4: "1755",
                  accountFingerprint: "cmb-credit-card:1755",
                }
              : account,
          ),
        ),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.setInputFiles("#fileInput", {
      name: "cmb-credit-card-overlap-statement.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`招商银行信用卡对账单（个人消费卡账户 2026年03月）
CMB Credit Card Statement (2026.03)
03/06 掌上生活还款 -30,435.91 6746 -30,435.91
03/01 03/01 增值服务使用费-用卡安全保障 5.00 1755 5.00`),
    });
    await page.click("#importButton");
    await page.waitForTimeout(300);
    assert.match(
      await page.locator("#detectedAccountPanel").textContent(),
      /已匹配账户：招商银行信用卡 尾号1755/u,
    );
    await page.click("#confirmImportButton");
    await page.waitForTimeout(300);
    assert.equal(
      await page.locator("#accountList input[value='招商银行信用卡 尾号1755/6746']").count(),
      0,
    );
  } finally {
    await browser.close();
    await server.close();
  }
});

test("scopes category options by type and adds quick transfer entries", async (t) => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify([
          { id: "checking", name: "储蓄卡", openingBalance: 1000 },
          { id: "credit", name: "信用卡", openingBalance: 0 },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    assert.deepEqual(await page.locator("#directionInput option").allTextContents(), [
      "支出",
      "收入",
      "转账",
    ]);

    let categoryOptions = await page.locator("#categoryInput option").allTextContents();
    assert.ok(categoryOptions.includes("餐饮"));
    assert.ok(categoryOptions.includes("其他支出"));
    assert.equal(categoryOptions.includes("收入"), false);
    assert.equal(categoryOptions.includes("工资"), false);

    await page.selectOption("#directionInput", "income");
    categoryOptions = await page.locator("#categoryInput option").allTextContents();
    assert.ok(categoryOptions.includes("工资"));
    assert.ok(categoryOptions.includes("其他收入"));
    assert.equal(categoryOptions.includes("餐饮"), false);
    assert.equal(categoryOptions.includes("交通"), false);

    await page.selectOption("#directionInput", "transfer");
    assert.deepEqual(await page.locator("#categoryInput option").allTextContents(), ["转账"]);
    assert.equal(await page.locator("#categoryInput").isDisabled(), true);
    assert.equal(await page.locator("#transferToAccountInput").isVisible(), true);

    await page.selectOption("#accountInput", "checking");
    await page.selectOption("#transferToAccountInput", "credit");
    await page.fill("#dateInput", "2026-07-08");
    await page.fill("#amountInput", "500");
    await page.fill("#descriptionInput", "还信用卡");
    await page.click("#entryForm button[type=submit]");

    assert.equal(await page.locator("#transactionRows tr").count(), 2);
    assert.equal(await page.locator(".type-tag.transfer-tag").count(), 2);
    const rows = await page.locator("#transactionRows tr").allTextContents();
    assert.match(rows.join("\n"), /储蓄卡[\s\S]*转账[\s\S]*-¥500\.00/u);
    assert.match(rows.join("\n"), /信用卡[\s\S]*转账[\s\S]*\+¥500\.00/u);

    await page.setInputFiles("#fileInput", {
      name: "typed-categories.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("2026-07-02 星巴克咖啡 -32.50\n2026-07-03 工资入账 12000.00 收入"),
    });
    await page.click("#importButton");
    await page.waitForSelector("#pendingRows tr");

    const expenseImportOptions = await page
      .locator("#pendingRows select")
      .nth(0)
      .locator("option")
      .allTextContents();
    const incomeImportOptions = await page
      .locator("#pendingRows select")
      .nth(1)
      .locator("option")
      .allTextContents();

    assert.ok(expenseImportOptions.includes("餐饮"));
    assert.equal(expenseImportOptions.includes("工资"), false);
    assert.ok(incomeImportOptions.includes("工资"));
    assert.equal(incomeImportOptions.includes("餐饮"), false);
    assert.equal(errors.join(" | "), "");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("uses saved merchant history to suggest quick entry categories", async (t) => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-transactions-v1",
        JSON.stringify([
          {
            id: "learned-merchant-1",
            date: "2026-07-01",
            description: "支付宝-蓝鲸空间",
            amount: -88,
            direction: "expense",
            category: "娱乐",
            sequence: 1,
          },
          {
            id: "learned-merchant-2",
            date: "2026-07-02",
            description: "微信支付-蓝鲸空间",
            amount: -66,
            direction: "expense",
            category: "娱乐",
            sequence: 2,
          },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.selectOption("#directionInput", "expense");
    await page.fill("#descriptionInput", "财付通-蓝鲸空间");
    assert.equal(await page.locator("#categoryInput").inputValue(), "娱乐");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("uses saved merchant history to suggest imported transaction categories", async (t) => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-transactions-v1",
        JSON.stringify([
          {
            id: "learned-import-merchant-1",
            date: "2026-07-01",
            description: "支付宝-蓝鲸空间",
            amount: -88,
            direction: "expense",
            category: "娱乐",
            sequence: 1,
          },
          {
            id: "learned-import-merchant-2",
            date: "2026-07-02",
            description: "微信支付-蓝鲸空间",
            amount: -66,
            direction: "expense",
            category: "娱乐",
            sequence: 2,
          },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.setInputFiles("#fileInput", {
      name: "learned-merchant.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("2026-07-03 财付通-蓝鲸空间 -58.00"),
    });
    await page.click("#importButton");
    await page.waitForSelector("#pendingRows tr");

    assert.equal(await page.locator("#pendingRows select").inputValue(), "娱乐");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("preserves explicit AI import categories over merchant history", async (t) => {
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

  const server = await startStaticServer({
    aiImportPayload: {
      transactions: [
        {
          date: "2026-07-03",
          description: "财付通-蓝鲸空间",
          amount: "-58",
          category: "购物",
        },
      ],
    },
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-transactions-v1",
        JSON.stringify([
          {
            id: "learned-ai-merchant-1",
            date: "2026-07-01",
            description: "支付宝-蓝鲸空间",
            amount: -88,
            direction: "expense",
            category: "娱乐",
            sequence: 1,
          },
          {
            id: "learned-ai-merchant-2",
            date: "2026-07-02",
            description: "微信支付-蓝鲸空间",
            amount: -66,
            direction: "expense",
            category: "娱乐",
            sequence: 2,
          },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate((endpoint) => {
      globalThis.AI_CAIDUO_IMPORT_ENDPOINT = endpoint;
    }, `${server.url}ai-import`);

    await page.setInputFiles("#fileInput", {
      name: "ai-explicit-category.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("ignored"),
    });
    await page.click("#importButton");
    await page.waitForSelector("#pendingRows tr");

    assert.equal(await page.locator("#pendingRows select").inputValue(), "购物");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("keeps AI-imported single transfer rows after confirm and reload", async (t) => {
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

  const server = await startStaticServer({
    aiImportPayload: {
      transactions: [
        {
          date: "2026-07-07",
          description: "账户互转",
          amount: "-200",
          type: "transfer",
          category: "收入",
        },
      ],
    },
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.addInitScript(() => {
      const RealDate = Date;
      const frozenTime = new RealDate(2026, 6, 19, 12, 0, 0).valueOf();
      class FrozenDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [frozenTime]));
        }

        static now() {
          return frozenTime;
        }
      }
      globalThis.Date = FrozenDate;
    });

    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.evaluate((endpoint) => {
      globalThis.AI_CAIDUO_IMPORT_ENDPOINT = endpoint;
    }, `${server.url}ai-import`);

    await page.setInputFiles("#fileInput", {
      name: "ai-transfer.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("ignored"),
    });
    await page.click("#importButton");
    await page.waitForSelector("#pendingRows tr");
    assert.equal(await page.locator("#pendingRows tr").count(), 1);
    assert.equal(await page.locator("#pendingRows select").isDisabled(), true);
    assert.match(await page.locator("#pendingRows tr").first().textContent(), /转账/u);

    await page.click("#confirmImportButton");
    await page.waitForFunction(() =>
      (document.querySelector("#importStatus")?.textContent || "").includes("已入账"),
    );
    await page.reload({ waitUntil: "domcontentloaded" });

    assert.equal(await page.locator(".type-tag.transfer-tag").count(), 1);
    const savedTransactions = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ai-caiduo-transactions-v1") || "[]").map(
        ({ type, transferMatch, category }) => ({ type, transferMatch, category }),
      ),
    );
    assert.deepEqual(savedTransactions, [
      { type: "transfer", transferMatch: "explicit", category: "转账" },
    ]);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("colors transaction record category type and amount by transaction type", async (t) => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.addInitScript(() => {
      const RealDate = Date;
      const frozenTime = new RealDate(2026, 6, 19, 12, 0, 0).valueOf();
      class FrozenDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [frozenTime]));
        }

        static now() {
          return frozenTime;
        }
      }
      globalThis.Date = FrozenDate;
    });

    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify([
          { id: "checking", name: "储蓄卡", openingBalance: 1000 },
          { id: "credit", name: "信用卡", openingBalance: 0 },
        ]),
      );
      localStorage.setItem(
        "ai-caiduo-transactions-v1",
        JSON.stringify([
          {
            id: "expense-row",
            date: "2026-07-10",
            description: "午餐",
            amount: -32.5,
            direction: "expense",
            category: "餐饮",
            accountId: "checking",
            sequence: 1,
          },
          {
            id: "income-row",
            date: "2026-07-11",
            description: "工资入账",
            amount: 12000,
            direction: "income",
            category: "工资",
            accountId: "checking",
            sequence: 2,
          },
          {
            id: "transfer-out",
            date: "2026-07-12",
            description: "账户互转",
            amount: -500,
            direction: "expense",
            type: "transfer",
            category: "转账",
            accountId: "checking",
            sequence: 3,
          },
          {
            id: "transfer-in",
            date: "2026-07-12",
            description: "账户互转",
            amount: 500,
            direction: "income",
            type: "transfer",
            category: "转账",
            accountId: "credit",
            sequence: 4,
          },
          {
            id: "refund-in",
            date: "2026-07-13",
            description: "财付通-虎头军煎饼（鼎成中心店）",
            amount: 14,
            direction: "income",
            category: "退款",
            accountId: "checking",
            sequence: 5,
          },
          {
            id: "refund-out",
            date: "2026-07-13",
            description: "财付通-虎头军煎饼（鼎成中心店）",
            amount: -14,
            direction: "expense",
            category: "餐饮",
            accountId: "checking",
            sequence: 6,
          },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    const rowStyles = await page.locator("#transactionRows tr").evaluateAll((rows) => {
      const summarize = (element) => {
        const style = getComputedStyle(element);
        return {
          color: style.color,
          background: style.backgroundColor,
          radius: style.borderRadius,
          text: element.textContent.trim(),
        };
      };

      return Object.fromEntries(
        rows.map((row) => {
          const category = row.cells[4].querySelector(".tag");
          const type = row.cells[5].querySelector(".type-tag");
          const amount = row.cells[6];
          const id = row.querySelector("[data-select-id]").dataset.selectId;
          return [
            id,
            {
              description: row.cells[3].textContent.trim(),
              category: summarize(category),
              type: type ? summarize(type) : null,
              amount: summarize(amount),
            },
          ];
        }),
      );
    });

    assert.equal(rowStyles["income-row"].category.color, "rgb(215, 98, 72)");
    assert.equal(rowStyles["income-row"].type.color, "rgb(215, 98, 72)");
    assert.equal(rowStyles["income-row"].amount.color, "rgb(215, 98, 72)");
    assert.equal(rowStyles["income-row"].type.text, "收入");
    assert.notEqual(rowStyles["income-row"].type.background, "rgba(0, 0, 0, 0)");
    assert.ok(parseFloat(rowStyles["income-row"].type.radius) > 10);

    assert.equal(rowStyles["expense-row"].category.color, "rgb(19, 101, 82)");
    assert.equal(rowStyles["expense-row"].type.color, "rgb(19, 101, 82)");
    assert.equal(rowStyles["expense-row"].amount.color, "rgb(19, 101, 82)");
    assert.equal(rowStyles["expense-row"].type.text, "支出");
    assert.notEqual(rowStyles["expense-row"].type.background, "rgba(0, 0, 0, 0)");
    assert.ok(parseFloat(rowStyles["expense-row"].type.radius) > 10);

    for (const transferId of ["transfer-out", "transfer-in"]) {
      assert.equal(rowStyles[transferId].category.color, "rgb(102, 112, 106)");
      assert.equal(rowStyles[transferId].type.color, "rgb(102, 112, 106)");
      assert.equal(rowStyles[transferId].amount.color, "rgb(105, 113, 109)");
      assert.equal(rowStyles[transferId].category.text, "转账");
      assert.equal(rowStyles[transferId].type.text, "转账");
      assert.notEqual(rowStyles[transferId].type.background, "rgba(0, 0, 0, 0)");
      assert.ok(parseFloat(rowStyles[transferId].type.radius) > 10);
    }

    for (const refundId of ["refund-in", "refund-out"]) {
      assert.equal(rowStyles[refundId].category.color, "rgb(102, 112, 106)");
      assert.equal(rowStyles[refundId].type.color, "rgb(102, 112, 106)");
      assert.equal(rowStyles[refundId].amount.color, "rgb(105, 113, 109)");
      assert.equal(rowStyles[refundId].category.text, "已退款");
      assert.equal(rowStyles[refundId].type.text, "已退款");
      assert.notEqual(rowStyles[refundId].type.background, "rgba(0, 0, 0, 0)");
      assert.ok(parseFloat(rowStyles[refundId].type.radius) > 10);
    }
  } finally {
    await browser.close();
    await server.close();
  }
});

test("selects multiple transaction rows and displays generic transfer tags", async (t) => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await page.addInitScript(() => {
      const RealDate = Date;
      const frozenTime = new RealDate("2026-03-19T12:00:00.000Z").valueOf();
      class FrozenDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [frozenTime]));
        }

        static now() {
          return frozenTime;
        }
      }
      globalThis.Date = FrozenDate;
    });

    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify([
          { id: "savings-3598", name: "招商银行 尾号3598", openingBalance: 50000 },
          { id: "credit-1755", name: "招商银行信用卡 尾号1755", openingBalance: 0 },
        ]),
      );
      localStorage.setItem(
        "ai-caiduo-transactions-v1",
        JSON.stringify([
          {
            id: "savings-payment",
            date: "2026-03-06",
            description: "储蓄卡还款",
            amount: -30435.91,
            direction: "expense",
            category: "其他",
            accountId: "savings-3598",
            source: "file",
            createdAt: "2026-03-06T08:00:00.000Z",
            sequence: 1,
          },
          {
            id: "credit-repayment",
            date: "2026-03-06",
            description: "信用卡入账",
            amount: 30435.91,
            direction: "income",
            category: "收入",
            accountId: "credit-1755",
            source: "file",
            createdAt: "2026-03-06T08:01:00.000Z",
            sequence: 2,
          },
          {
            id: "coffee",
            date: "2026-03-07",
            description: "咖啡",
            amount: -20,
            direction: "expense",
            category: "餐饮",
            accountId: "savings-3598",
            source: "manual",
            createdAt: "2026-03-07T08:00:00.000Z",
            sequence: 3,
          },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    assert.equal(errors.join(" | "), "");
    assert.equal(await page.locator("#transactionRows tr").count(), 3);
    assert.equal(await page.locator(".type-tag.transfer-tag").count(), 2);
    assert.equal(await page.locator(".amount-cell.transfer-text").count(), 2);
    assert.equal(await page.locator(".tag.transfer-tag").count(), 2);
    assert.equal(await page.locator("#incomeTotal").textContent(), "¥0.00");
    assert.equal(await page.locator("#expenseTotal").textContent(), "¥20.00");
    assert.equal(
      await page.locator("#incomeTotal").evaluate((element) => getComputedStyle(element).color),
      "rgb(215, 98, 72)",
    );
    assert.equal(
      await page.locator("#expenseTotal").evaluate((element) => getComputedStyle(element).color),
      "rgb(19, 101, 82)",
    );

    await page.check('[data-select-id="savings-payment"]');
    await page.check('[data-select-id="credit-repayment"]');
    assert.match(await page.locator("#selectedTransactionCount").textContent(), /已选择 2 项/u);
    assert.equal(await page.locator("#clearButton").textContent(), "删除所选");

    await page.selectOption("#categoryFilter", "餐饮");
    assert.match(await page.locator("#selectedTransactionCount").textContent(), /已选择 0 项/u);
    assert.equal(await page.locator("#clearButton").textContent(), "清空");
    await page.selectOption("#categoryFilter", "all");
    await page.check('[data-select-id="savings-payment"]');
    await page.check('[data-select-id="credit-repayment"]');
    assert.match(await page.locator("#selectedTransactionCount").textContent(), /已选择 2 项/u);

    page.once("dialog", (dialog) => dialog.accept());
    await page.click("#clearButton");

    assert.equal(await page.locator("#transactionRows tr").count(), 1);
    assert.match(await page.locator("#transactionRows").textContent(), /咖啡/u);
    assert.match(await page.locator("#selectedTransactionCount").textContent(), /已选择 0 项/u);
    assert.equal(await page.locator("#clearButton").textContent(), "清空");
  } finally {
    await browser.close();
    await server.close();
  }
});

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
          "收/支 交易对方 商品说明 付款方式 金额 交易订单号 商家订单号 交易时间\n" +
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

test("shows Alipay reconciliation ambiguity notices without updating existing transactions", async (t) => {
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
  const statementHeader =
    "支付宝支付科技有限公司 交易流水证明\n" +
    "收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间\n";
  const statementRow =
    "支出 高德打车 高德打车订单 招商银行信用卡(1755) 14.49 20260324220014662214274 0003N202603240000000014 2026-03-24 21:53:45";

  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });

    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify([
          { id: "credit-a", name: "招商银行信用卡 尾号1755", accountNumberLast4: "1755" },
          { id: "credit-b", name: "招商银行信用卡 备用1755", accountNumberLast4: "1755" },
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
            accountId: "credit-a",
            sequence: 1,
          },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.setInputFiles("#fileInput", {
      name: "ambiguous-account.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(statementHeader + statementRow),
    });
    await page.click("#importButton");
    await page.waitForFunction(() =>
      (document.querySelector("#detectedAccountPanel")?.textContent || "").includes("匹配到多个账户"),
    );
    assert.equal(await page.locator("#pendingRows tr").count(), 0);
    assert.match(await page.locator("#detectedAccountPanel").textContent(), /匹配到多个账户/u);

    await page.evaluate(() => {
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify([{ id: "credit-1755", name: "招商银行信用卡 尾号1755", accountNumberLast4: "1755" }]),
      );
      localStorage.setItem(
        "ai-caiduo-transactions-v1",
        JSON.stringify([
          {
            id: "weak-match",
            date: "2026-03-24",
            description: "高德",
            amount: -14.49,
            direction: "expense",
            category: "其他支出",
            accountId: "credit-1755",
            sequence: 1,
          },
          {
            id: "other-match",
            date: "2026-03-24",
            description: "滴滴",
            amount: -14.49,
            direction: "expense",
            category: "其他支出",
            accountId: "credit-1755",
            sequence: 2,
          },
        ]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.setInputFiles("#fileInput", {
      name: "weak-description-match.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(statementHeader + statementRow),
    });
    await page.click("#importButton");
    await page.waitForFunction(() =>
      (document.querySelector("#detectedAccountPanel")?.textContent || "").includes("描述匹配不够明确"),
    );
    assert.equal(await page.locator("#pendingRows tr").count(), 0);
    assert.match(await page.locator("#detectedAccountPanel").textContent(), /描述匹配不够明确/u);

    await page.evaluate(() => {
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
      name: "duplicate-target.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(statementHeader + statementRow + "\n" + statementRow.replace("14274", "14275")),
    });
    await page.click("#importButton");
    await page.waitForFunction(() =>
      (document.querySelector("#detectedAccountPanel")?.textContent || "").includes("重复指向同一已有流水"),
    );
    assert.equal(await page.locator("#pendingRows tr").count(), 0);
    assert.match(await page.locator("#detectedAccountPanel").textContent(), /重复指向同一已有流水/u);
    assert.equal(await page.locator("#confirmImportButton").isDisabled(), true);
  } finally {
    await browser.close();
    await server.close();
  }
});

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

test("imports true Alipay balance rows into an existing Alipay account without manual selection", async (t) => {
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
    await page.addInitScript(() => {
      const RealDate = Date;
      const frozenTime = new RealDate("2026-03-15T12:00:00.000Z").valueOf();
      class FrozenDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [frozenTime]));
        }

        static now() {
          return frozenTime;
        }
      }
      globalThis.Date = FrozenDate;
    });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "ai-caiduo-accounts-v1",
        JSON.stringify([
          { id: "cmb-credit-card", name: "招商信用卡", openingBalance: 0 },
          { id: "alipay", name: "支付宝", openingBalance: 100 },
        ]),
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
    assert.equal(await page.locator("#detectedAccountPanel").isHidden(), true);
    assert.equal(await page.locator("#importAccountInput").inputValue(), "alipay");
    await page.click("#confirmImportButton");
    await page.waitForFunction(() =>
      (document.querySelector("#importStatus")?.textContent || "").includes("已入账"),
    );
    const savedTransactions = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ai-caiduo-transactions-v1") || "[]"),
    );
    assert.equal(savedTransactions.length, 1);
    assert.equal(savedTransactions[0].accountId, "alipay");
    await page.selectOption("#accountFilterInput", "alipay");

    assert.equal(await page.locator("#transactionRows tr").count(), 1);
    assert.match(await page.locator("#transactionRows tr").first().textContent(), /星巴克/u);
    assert.match(await page.locator("#transactionRows tr").first().textContent(), /¥67\.50/u);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("requires an account before confirming true Alipay balance rows", async (t) => {
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
        JSON.stringify([{ id: "cmb-credit-card", name: "招商信用卡", openingBalance: 0 }]),
      );
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    await page.setInputFiles("#fileInput", {
      name: "alipay-balance-no-account.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "支付宝支付科技有限公司 交易流水证明\n" +
          "收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间\n" +
          "支出 星巴克 星巴克咖啡 支付宝余额 32.50 20260301220014662214274 A0001 2026-03-01 09:30:00",
      ),
    });
    await page.click("#importButton");
    await page.waitForSelector("#pendingRows tr");
    assert.equal(await page.locator("#importAccountInput").inputValue(), "__unassigned__");

    await page.click("#confirmImportButton");
    await page.waitForFunction(() =>
      (document.querySelector("#importStatus")?.textContent || "").includes("请选择入账账户"),
    );

    const savedTransactions = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ai-caiduo-transactions-v1") || "[]"),
    );
    assert.deepEqual(savedTransactions, []);
    assert.equal(await page.locator("#pendingRows tr").count(), 1);
  } finally {
    await browser.close();
    await server.close();
  }
});

test("does not annotate a single unrelated Alipay bank-card transaction", async (t) => {
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
        ]),
      );
      localStorage.setItem(
        "ai-caiduo-transactions-v1",
        JSON.stringify([
          {
            id: "unrelated-card-row",
            date: "2026-03-24",
            description: "便利店购物",
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
      name: "alipay-unrelated-card-row.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "支付宝支付科技有限公司 交易流水证明\n" +
          "收/支 交易对方 商品说明 付款方式 金额 交易订单号 商家订单号 交易时间\n" +
          "支出 高德打车 高德打车订单 招商银行信用卡(1755) 14.49 20260324220014662214274 0003N202603240000000014 2026-03-24 21:53:45",
      ),
    });
    await page.click("#importButton");
    await page.waitForFunction(() =>
      (document.querySelector("#detectedAccountPanel")?.textContent || "").includes("描述匹配不够明确"),
    );

    assert.equal(await page.locator("#pendingRows tr").count(), 0);
    assert.equal(await page.locator("#confirmImportButton").isDisabled(), true);
    const savedTransactions = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("ai-caiduo-transactions-v1") || "[]"),
    );
    assert.equal(savedTransactions[0].description, "便利店购物");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("initializes the date range from the local calendar date", async (t) => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 900 },
      timezoneId: "Asia/Shanghai",
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      const RealDate = Date;
      const frozenTime = new RealDate("2026-08-31T18:00:00.000Z").valueOf();
      class FrozenDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [frozenTime]));
        }

        static now() {
          return frozenTime;
        }
      }
      globalThis.Date = FrozenDate;
    });

    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });

    assert.equal(await page.locator("#dateInput").inputValue(), "2026-09-01");
    assert.equal(await page.locator("#dateRangeLabel").textContent(), "2026-09-01");
    await page.click("#dateRangeButton");
    assert.equal(await page.locator("#calendarMonthLabel").textContent(), "2026年9月");
  } finally {
    await browser.close();
    await server.close();
  }
});

test("keeps date range calendar columns aligned on narrow screens", async (t) => {
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
  const browser = await chromium.launch({
    headless: true,
    executablePath: edgePath,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.click("#dateRangeButton");

    const metrics = await page.evaluate(() => {
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      };
      const panel = document.querySelector("#dateRangePanel");
      const weekdayWidths = [...document.querySelectorAll(".calendar-weekdays span")].map(
        (element) => rectOf(element).width,
      );
      const dayRects = [...document.querySelectorAll(".calendar-day:not(:disabled)")].map(rectOf);
      return {
        panel: rectOf(panel),
        scrollWidth: panel.scrollWidth,
        clientWidth: panel.clientWidth,
        weekdayWidths,
        dayWidths: dayRects.slice(0, 7).map((rect) => rect.width),
        maxDayRight: Math.max(...dayRects.map((rect) => rect.right)),
      };
    });

    assert.ok(metrics.scrollWidth <= metrics.clientWidth + 1);
    for (const dayWidth of metrics.dayWidths) {
      assert.ok(Math.abs(dayWidth - metrics.weekdayWidths[0]) <= 1);
    }
    assert.ok(metrics.maxDayRight <= metrics.panel.right + 1);
  } finally {
    await browser.close();
    await server.close();
  }
});

function startStaticServer(options = {}) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (request.method === "POST" && pathname === "/ai-import") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(options.aiImportPayload || { transactions: [] }));
        return;
      }

      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      const filePath = join(rootDir, relativePath);
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": getContentType(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  return new Promise((resolve, reject) => {
    let attempts = 0;
    const listen = () => {
      if (attempts >= 2000) {
        reject(new Error("Unable to find an available browser-safe test port"));
        return;
      }
      attempts += 1;
      const port = nextStaticServerPort;
      nextStaticServerPort = nextStaticServerPort >= 45100 ? 43100 : nextStaticServerPort + 1;
      const onError = (error) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" || error.code === "EACCES") {
          listen();
          return;
        }
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        resolve({
          url: `http://127.0.0.1:${address.port}/`,
          close: () =>
            new Promise((closeResolve, closeReject) => {
              server.close((error) => (error ? closeReject(error) : closeResolve()));
            }),
        });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    };
    listen();
  });
}

function getContentType(filePath) {
  const extension = extname(filePath);
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js" || extension === ".mjs") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".webmanifest") {
    return "application/manifest+json; charset=utf-8";
  }
  if (extension === ".png") {
    return "image/png";
  }
  return "application/octet-stream";
}
