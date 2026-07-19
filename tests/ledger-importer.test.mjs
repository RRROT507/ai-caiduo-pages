import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  analyzeLedgerFile,
  parseCmbCreditCardStatementText,
  parseCmbTransactionStatement,
} from "../assets/ledger-importer.mjs";

test("analyzes a local statement text file with fallback parsing", async () => {
  const file = new File(
    [
      `2026-07-02 星巴克咖啡 -32.50
2026/07/03 工资入账 12000.00 收入
07-04 滴滴出行 支出 48.20`,
    ],
    "cmb-statement.txt",
    { type: "text/plain" },
  );

  const result = await analyzeLedgerFile(file, { fallbackYear: 2026 });

  assert.equal(result.mode, "local");
  assert.equal(result.message, "已使用本地解析生成预览");
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
        date: "2026-07-02",
        description: "星巴克咖啡",
        amount: -32.5,
        direction: "expense",
        category: "餐饮",
        source: "file",
      },
      {
        date: "2026-07-03",
        description: "工资入账",
        amount: 12000,
        direction: "income",
        category: "收入",
        source: "file",
      },
      {
        date: "2026-07-04",
        description: "滴滴出行",
        amount: -48.2,
        direction: "expense",
        category: "交通",
        source: "file",
      },
    ],
  );
});

test("normalizes transactions returned by an AI import endpoint", async () => {
  const endpoint = await startJsonEndpoint({
    transactions: [
      {
        date: "2026-07-05",
        description: "招商银行还款",
        amount: "-500.00",
      },
      {
        date: "2026-07-06",
        description: "工资",
        amount: "10000",
        direction: "income",
      },
    ],
  });
  const file = new File(["ignored"], "cmb-statement.pdf", { type: "application/pdf" });

  try {
    const result = await analyzeLedgerFile(file, {
      endpoint: endpoint.url,
      fallbackYear: 2026,
    });

    assert.equal(result.mode, "ai");
    assert.equal(result.message, "AI 已生成预览");
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
          date: "2026-07-05",
          description: "招商银行还款",
          amount: -500,
          direction: "expense",
          category: "其他",
          source: "ai",
        },
        {
          date: "2026-07-06",
          description: "工资",
          amount: 10000,
          direction: "income",
          category: "收入",
          source: "ai",
        },
      ],
    );
    assert.equal(endpoint.requests.length, 1);
    assert.match(endpoint.requests[0], /filename="cmb-statement.pdf"/u);
  } finally {
    await endpoint.close();
  }
});

test("keeps local account candidate when AI endpoint returns transactions", async () => {
  const endpoint = await startJsonEndpoint({
    transactions: [
      {
        date: "2026-02-23",
        description: "AI parsed row",
        amount: "31.74",
        direction: "income",
      },
    ],
  });
  const file = new File(
    [
      `Transaction Statement of China Merchants Bank
Account No: 214850121113598
Transaction Date Currency Amount Balance Description
2026-02-23 CNY 31.74 4,000.00 ChaChaBao transfer out`,
    ],
    "cmb-transaction-statement.txt",
    { type: "text/plain" },
  );

  try {
    const result = await analyzeLedgerFile(file, {
      endpoint: endpoint.url,
      fallbackYear: 2026,
    });

    assert.equal(result.mode, "ai");
    assert.equal(result.transactions.length, 1);
    assert.equal(result.accountCandidate.accountFingerprint, "cmb:3598");
    assert.equal(result.accountCandidate.accountNumberLast4, "3598");
    assert.equal(result.accountCandidate.openingBalanceEstimate, 3968.26);
  } finally {
    await endpoint.close();
  }
});

test("does not parse binary pdf internals as transactions", async () => {
  const file = new File(
    [
      `%PDF-1.7
1 0 obj
<< /Producer (OpenPDF) /ModDate (D:20150330120000) >>
stream
2015-03-30 binary-object-fragment 1.40
endstream
endobj`,
    ],
    "binary-looking.pdf",
    { type: "application/pdf" },
  );

  const result = await analyzeLedgerFile(file, { fallbackYear: 2026 });

  assert.equal(result.transactions.length, 0);
  assert.equal(result.mode, "needs-ai-backend");
});

test("parses China Merchants Bank transaction statement rows by signed amount", async () => {
  const file = new File(
    [
      `招商银行交易流水
Transaction Statement of China Merchants Bank
2026-01-01 -- 2026-06-30
卡 账号：6214850121113598
申请时间：2026-07-18 16:02:56 验证码：3EP63HFA
交易日期 币种 交易金额 账户余额 交易摘要 交易对方信息
Transaction
Date Currency Balance Transaction Type Counter Party
Amount
2026-02-23 CNY 31.74 4,000.00 朝朝宝转出
2026-02-23 CNY -4,000.00 0.00 转账汇款 薛瑾 6214831001555389
2026-02-23 CNY 4,000.00 4,000.00 汇入汇款 张凯 6214680067553394`,
    ],
    "招商银行交易流水.txt",
    { type: "text/plain" },
  );

  const result = await analyzeLedgerFile(file, { fallbackYear: 2026 });

  assert.equal(result.mode, "local");
  assert.deepEqual(result.accountCandidate, {
    institution: "招商银行",
    accountName: "招商银行 尾号3598",
    accountNumberLast4: "3598",
    accountFingerprint: "cmb:3598",
    openingBalanceEstimate: 3968.26,
  });
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
        date: "2026-02-23",
        description: "朝朝宝转出",
        amount: 31.74,
        direction: "income",
        category: "收入",
        source: "file",
      },
      {
        date: "2026-02-23",
        description: "转账汇款 薛瑾 6214831001555389",
        amount: -4000,
        direction: "expense",
        category: "其他",
        source: "file",
      },
      {
        date: "2026-02-23",
        description: "汇入汇款 张凯 6214680067553394",
        amount: 4000,
        direction: "income",
        category: "收入",
        source: "file",
      },
    ],
  );
});

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

test("parses China Merchants Bank credit card statement rows", () => {
  const transactions = parseCmbCreditCardStatementText(
    `招商银行信用卡对账单（个人消费卡账户 2026年03月）
03/06 掌上生活还款 -30,435.91 6746 -30,435.91
03/06 掌上生活还款回馈金 -3.00 6746 -3.00
03/01 03/01 增值服务使用费-用卡安全保障 5.00 1755 5.00
03/02 03/03 财付通-虎头军煎饼（鼎成中心店） -14.00 1755 -14.00
02/23 02/24 朝朝宝 31.74 1755 31.74
03/10 03/11 支付宝-高德打车 10.30 1755 10.30`,
    { fallbackYear: 2026 },
  );

  assert.deepEqual(
    transactions.map(({ date, description, amount, direction, category, source }) => ({
      date,
      description,
      amount,
      direction,
      category,
      source,
    })),
    [
      {
        date: "2026-03-06",
        description: "掌上生活还款",
        amount: 30435.91,
        direction: "income",
        category: "收入",
        source: "file",
      },
      {
        date: "2026-03-06",
        description: "掌上生活还款回馈金",
        amount: 3,
        direction: "income",
        category: "收入",
        source: "file",
      },
      {
        date: "2026-03-01",
        description: "增值服务使用费-用卡安全保障",
        amount: -5,
        direction: "expense",
        category: "其他",
        source: "file",
      },
      {
        date: "2026-03-02",
        description: "财付通-虎头军煎饼（鼎成中心店）",
        amount: 14,
        direction: "income",
        category: "收入",
        source: "file",
      },
      {
        date: "2026-02-23",
        description: "朝朝宝",
        amount: -31.74,
        direction: "expense",
        category: "其他",
        source: "file",
      },
      {
        date: "2026-03-10",
        description: "支付宝-高德打车",
        amount: -10.3,
        direction: "expense",
        category: "交通",
        source: "file",
      },
    ],
  );
});

test("extracts account candidate from China Merchants Bank credit card statement", async () => {
  const file = new File(
    [
      `招商银行信用卡对账单（个人消费卡账户 2026年03月）
CMB Credit Card Statement (2026.03)
本期账务明细 Transaction Details
人民币账户 RMB A/C
交易日 记账日 交易摘要 人民币金额 卡号末四位 交易地金额
SOLD POSTED DESCRIPTION RMB AMOUNT CARD NO(Last 4digits) Original Tran Amount
03/06 掌上生活还款 -30,435.91 6746 -30,435.91
03/01 03/01 增值服务使用费-用卡安全保障 5.00 1755 5.00
03/10 03/11 支付宝-高德打车 10.30 1755 10.30`,
    ],
    "CreditCardReckoning2026-03.txt",
    { type: "text/plain" },
  );

  const result = await analyzeLedgerFile(file, { fallbackYear: 2026 });

  assert.equal(result.mode, "local");
  assert.deepEqual(result.accountCandidate, {
    institution: "招商银行",
    accountName: "招商银行信用卡 尾号1755/6746",
    accountNumberLast4: "1755/6746",
    accountFingerprint: "cmb-credit-card:1755-6746",
    openingBalanceEstimate: 0,
  });
});

function startJsonEndpoint(responseBody) {
  const requests = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push(Buffer.concat(chunks).toString("latin1"));
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(responseBody));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/ai-import`,
        requests,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
      });
    });
  });
}
