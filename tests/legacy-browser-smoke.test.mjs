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
  } finally {
    await browser.close();
    await server.close();
  }
});

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
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

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
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
