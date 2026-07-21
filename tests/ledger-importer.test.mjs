import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  analyzeLedgerFile,
  classifyAlipayPaymentMethod,
  parseAlipayStatement,
  parseBankOfBeijingStatementText,
  parseCmbCreditCardStatementText,
  parseCmbTransactionStatement,
} from "../assets/ledger-importer.mjs";

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

test("parses wrapped Alipay payment methods from PDF text", () => {
  const result = parseAlipayStatement(`支付宝支付科技有限公司 交易流水证明
收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间
支出 山东高速信联 ETC通行费 招商银行信用 4.75 20260331220014662214106 20260331112780012200089 2026-03-31
科技股份有限 卡(1755) 53640 14676_1 21:22:06
公司
支出 国网北京市电 电费自动缴费- 招商银行信用 100.00 20260330000030012200052 1101082389449 2026-03-30
力公司 **2号-金辰府-根 卡(1755) 67705 12:08:41
据每期出账后自动
缴费
不计 上海顺途科技 退款-北京丰台运 招商银行信用 317.50 20260311230014662214193 20260311ALPP00101750541 2026-03-31
收支 有限公司 城北 卡(1755) 49019_20260331ALRP00295 0 00:08:52`);

  assert.equal(result.transactions.length, 0);
  assert.equal(result.reconciliationItems.length, 2);
  assert.equal(result.skippedItems.length, 1);
  assert.deepEqual(
    result.reconciliationItems.map(({ date, paymentMethod, paymentAccountCandidate }) => ({
      date,
      paymentMethod,
      paymentAccountCandidate,
    })),
    [
      {
        date: "2026-03-31",
        paymentMethod: "招商银行信用卡(1755)",
        paymentAccountCandidate: {
          institution: "招商银行",
          accountKind: "credit-card",
          accountNumberLast4: "1755",
          accountFingerprint: "cmb-credit-card:1755",
          displayName: "招商银行信用卡 尾号1755",
        },
      },
      {
        date: "2026-03-30",
        paymentMethod: "招商银行信用卡(1755)",
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
  assert.deepEqual(
    result.skippedItems.map(({ paymentMethod, skipReason }) => ({ paymentMethod, skipReason })),
    [{ paymentMethod: "招商银行信用卡(1755)", skipReason: "excluded-by-statement" }],
  );
});

test("parses Alipay balance rows as importable Alipay transactions", () => {
  const result = parseAlipayStatement(`支付宝支付科技有限公司 交易流水证明
收/支 交易对方 商品说明 收/付款方式 金额 交易订单号 商家订单号 交易时间
支出 星巴克 星巴克咖啡 支付宝余额 32.50 20260301220014662214274 A0001 2026-03-01 09:30:00`);

  assert.equal(result.reconciliationItems.length, 0);
  assert.equal(result.statementType, "alipay");
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

test("keeps Alipay balance rows when a continuation mentions a card suffix", () => {
  const result = parseAlipayStatement(`支付宝支付科技有限公司 交易流水证明
支出 甲方 商品说明 支付宝余额 12.00 order merchant 2026-03-04
会员卡(1755) 999 10:00:00`);

  assert.equal(result.reconciliationItems.length, 0);
  assert.equal(result.skippedItems.length, 0);
  assert.deepEqual(
    result.transactions.map(({ date, amount, direction }) => ({
      date,
      amount,
      direction,
    })),
    [
      {
        date: "2026-03-04",
        amount: -12,
        direction: "expense",
      },
    ],
  );
});

test("records zero-amount Alipay rows as skipped items with row metadata", () => {
  const result = parseAlipayStatement(`支付宝支付科技有限公司 交易流水证明
收/付款方式
支出 甲方 商品 支付宝 0.00 order merchant 2026-03-02 09:30:00`);

  assert.equal(result.transactions.length, 0);
  assert.equal(result.reconciliationItems.length, 0);
  assert.deepEqual(
    result.skippedItems.map(({ date, counterparty, product, paymentMethod, amount, skipReason }) => ({
      date,
      counterparty,
      product,
      paymentMethod,
      amount,
      skipReason,
    })),
    [
      {
        date: "2026-03-02",
        counterparty: "甲方",
        product: "商品",
        paymentMethod: "支付宝",
        amount: 0,
        skipReason: "zero-amount",
      },
    ],
  );
});

test("records unsupported Alipay payment methods as skipped items", () => {
  const result = parseAlipayStatement(`支付宝支付科技有限公司 交易流水证明
收/付款方式
支出 甲方 商品 微信支付 12.00 order merchant 2026-03-03 09:30:00`);

  assert.equal(result.transactions.length, 0);
  assert.equal(result.reconciliationItems.length, 0);
  assert.deepEqual(
    result.skippedItems.map(({ date, counterparty, product, paymentMethod, amount, skipReason }) => ({
      date,
      counterparty,
      product,
      paymentMethod,
      amount,
      skipReason,
    })),
    [
      {
        date: "2026-03-03",
        counterparty: "甲方",
        product: "商品",
        paymentMethod: "微信支付",
        amount: -12,
        skipReason: "unsupported-payment-method",
      },
    ],
  );
});

test("classifies all supported Alipay balance labels", () => {
  for (const label of ["支付宝余额", "支付宝", "余额"]) {
    assert.equal(classifyAlipayPaymentMethod(label).scope, "alipay-account");
  }
});

test("preserves wrapped Alipay rows with unsupported payment methods as skipped items", () => {
  const result = parseAlipayStatement(`支付宝支付科技有限公司 交易流水证明
支出
甲方
商品
微信支付
12.00
order merchant
2026-03-03 09:30:00`);

  assert.equal(result.transactions.length, 0);
  assert.deepEqual(
    result.skippedItems.map(({ date, counterparty, product, paymentMethod, amount, skipReason }) => ({
      date,
      counterparty,
      product,
      paymentMethod,
      amount,
      skipReason,
    })),
    [
      {
        date: "2026-03-03",
        counterparty: "甲方",
        product: "商品",
        paymentMethod: "微信支付",
        amount: -12,
        skipReason: "unsupported-payment-method",
      },
    ],
  );
});

test("analyzes a local statement text file with fallback parsing", async () => {
  const file = new File(
    [
      `2026-07-02 星巴克咖啡 -32.50
2026/07/03 工资入账 12000.00 收入
07-04 滴滴出行 支出 48.20
2026-07-05 财付通-虎头军煎饼（鼎成中心店） -18.00
2026-07-06 支付宝-未知商户服务 -20.00
2026-03-03 财付通-PIZZAHUT -37.00`,
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
        category: "工资",
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
      {
        date: "2026-07-05",
        description: "财付通-虎头军煎饼（鼎成中心店）",
        amount: -18,
        direction: "expense",
        category: "餐饮",
        source: "file",
      },
      {
        date: "2026-07-06",
        description: "支付宝-未知商户服务",
        amount: -20,
        direction: "expense",
        category: "其他支出",
        source: "file",
      },
      {
        date: "2026-03-03",
        description: "财付通-PIZZAHUT",
        amount: -37,
        direction: "expense",
        category: "餐饮",
        source: "file",
      },
    ],
  );
});

test("does not treat a generic transaction proof as an Alipay statement", async () => {
  const file = new File(["交易流水证明\n2026-03-01 便利店购物 -12.50"], "generic-proof.txt", {
    type: "text/plain",
  });

  const result = await analyzeLedgerFile(file, { fallbackYear: 2026 });

  assert.equal(result.mode, "local");
  assert.notEqual(result.statementType, "alipay");
  assert.deepEqual(
    result.transactions.map(({ date, description, amount }) => ({ date, description, amount })),
    [{ date: "2026-03-01", description: "便利店购物", amount: -12.5 }],
  );
});

test("returns Alipay reconciliation and skipped items even when AI endpoint is configured", async () => {
  const endpoint = await startJsonEndpoint({
    transactions: [
      {
        date: "2026-03-24",
        description: "AI must not create bank-card row",
        amount: "14.49",
      },
    ],
  });
  const file = new File(
    [`支付宝支付科技有限公司 交易流水证明
支出 高德打车 高德打车订单 招商银行信用卡(1755) 14.49 order merchant 2026-03-24 21:53:45
支出 上海顺途科技有限公司 退款 微信支付 317.50 order merchant 2026-03-31 00:08:52`],
    "alipay-statement.txt",
    { type: "text/plain" },
  );

  try {
    const result = await analyzeLedgerFile(file, {
      endpoint: endpoint.url,
      fallbackYear: 2026,
    });

    assert.equal(result.mode, "local");
    assert.equal(result.transactions.length, 0);
    assert.equal(result.reconciliationItems.length, 1);
    assert.equal(result.skippedItems.length, 1);
    assert.equal(result.reconciliationItems[0].paymentMethod, "招商银行信用卡(1755)");
    assert.equal(result.skippedItems[0].skipReason, "unsupported-payment-method");
    assert.equal(endpoint.requests.length, 0);
  } finally {
    await endpoint.close();
  }
});

test("guards Alipay balance-only files from AI endpoint replacement", async () => {
  const endpoint = await startJsonEndpoint({
    transactions: [
      {
        date: "2026-03-01",
        description: "AI must not bypass Alipay payment-method safeguards",
        amount: "999.00",
      },
    ],
  });
  const file = new File(
    [`支付宝支付科技有限公司 交易流水证明
支出 星巴克 星巴克咖啡店 支付宝余额 32.50 order merchant 2026-03-01 09:30:00`],
    "alipay-balance-only.txt",
    { type: "text/plain" },
  );

  try {
    const result = await analyzeLedgerFile(file, {
      endpoint: endpoint.url,
      fallbackYear: 2026,
    });

    assert.equal(result.mode, "local");
    assert.deepEqual(
      result.transactions.map(({ date, description, amount, source }) => ({
        date,
        description,
        amount,
        source,
      })),
      [
        {
          date: "2026-03-01",
          description: "星巴克 - 星巴克咖啡店",
          amount: -32.5,
          source: "file",
        },
      ],
    );
    assert.equal(result.reconciliationItems.length, 0);
    assert.equal(result.skippedItems.length, 0);
    assert.equal(endpoint.requests.length, 0);
  } finally {
    await endpoint.close();
  }
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
      {
        date: "2026-07-07",
        description: "账户互转",
        amount: "-200",
        type: "transfer",
        category: "收入",
      },
      {
        date: "2026-07-08",
        description: "财付通-虎头军煎饼（鼎成中心店）",
        amount: "-18",
        category: "其他支出",
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
      result.transactions.map(
        ({ date, description, amount, direction, type, transferMatch, category, source }) => ({
        date,
        description,
        amount,
        direction,
        type,
        transferMatch,
        category,
        source,
        }),
      ),
      [
        {
          date: "2026-07-05",
          description: "招商银行还款",
          amount: -500,
          direction: "expense",
          type: undefined,
          transferMatch: undefined,
          category: "其他支出",
          source: "ai",
        },
        {
          date: "2026-07-06",
          description: "工资",
          amount: 10000,
          direction: "income",
          type: undefined,
          transferMatch: undefined,
          category: "工资",
          source: "ai",
        },
        {
          date: "2026-07-07",
          description: "账户互转",
          amount: -200,
          direction: "expense",
          type: "transfer",
          transferMatch: "explicit",
          category: "转账",
          source: "ai",
        },
        {
          date: "2026-07-08",
          description: "财付通-虎头军煎饼（鼎成中心店）",
          amount: -18,
          direction: "expense",
          type: undefined,
          transferMatch: undefined,
          category: "餐饮",
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
        category: "利息",
        source: "file",
      },
      {
        date: "2026-02-23",
        description: "转账汇款 薛瑾 6214831001555389",
        amount: -4000,
        direction: "expense",
        category: "其他支出",
        source: "file",
      },
      {
        date: "2026-02-23",
        description: "汇入汇款 张凯 6214680067553394",
        amount: 4000,
        direction: "income",
        category: "其他收入",
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

test("parses Bank of Beijing personal transaction statement rows", () => {
  const transactions = parseBankOfBeijingStatementText(
    `北京银行个人客户交易流水清单
客户姓名：张凯 日期范围：2026-02-01—2026-03-31
卡/账号：6214680067553394 币种：人民币 流水单号：AOFC001006134243338
交易日期 币种 钞汇 业务摘要 发生额 余额 对方户名 对方账号
2026-03-29 人民币 汇 个贷还款 -6554.36 4431.41
2026-03-29 人民币 汇 公贷 -2461.00 10985.77 北京住房公积金管理中心 010905205001201110*
2026-03-29 人民币 汇 转账 +13446.77 13446.77 张凯 6214850121113598
2026-03-29 人民币 汇 个贷还款 -2507.71 0.00
2026-03-21 人民币 汇 利息 +0.56 2507.71 活期储蓄存款利息支出 521031000
2026-03-13 人民币 汇 还款 -618.33 2507.15
2026-02-28 人民币 汇 个贷还款 -8106.29 3125.48
2026-02-28 人民币 汇 公贷 -2215.00 11231.77 北京住房公积金管理中心 010905205001201110*
2026-02-28 人民币 汇 转账 +13446.77 13446.77 张凯 6214850121113598
2026-02-28 人民币 汇 个贷还款 -1098.95 0.00
2026-02-23 人民币 汇 转账 -4000.00 1098.95 张凯 6214850121113598
2026-02-13 人民币 汇 还款 -684.58 5098.95
第1页 共1页`,
  );

  assert.equal(transactions.length, 12);
  assert.deepEqual(
    transactions.slice(0, 5).map(({ date, description, amount, direction, category, source }) => ({
      date,
      description,
      amount,
      direction,
      category,
      source,
    })),
    [
      {
        date: "2026-03-29",
        description: "个贷还款",
        amount: -6554.36,
        direction: "expense",
        category: "其他支出",
        source: "file",
      },
      {
        date: "2026-03-29",
        description: "公贷 北京住房公积金管理中心",
        amount: -2461,
        direction: "expense",
        category: "其他支出",
        source: "file",
      },
      {
        date: "2026-03-29",
        description: "转账 张凯",
        amount: 13446.77,
        direction: "income",
        category: "其他收入",
        source: "file",
      },
      {
        date: "2026-03-29",
        description: "个贷还款",
        amount: -2507.71,
        direction: "expense",
        category: "其他支出",
        source: "file",
      },
      {
        date: "2026-03-21",
        description: "利息 活期储蓄存款利息支出",
        amount: 0.56,
        direction: "income",
        category: "利息",
        source: "file",
      },
    ],
  );
});

test("extracts account candidate from Bank of Beijing statement", async () => {
  const file = new File(
    [
      `北京银行个人客户交易流水清单
客户姓名：张凯 日期范围：2026-02-01—2026-03-31
卡/账号：6214680067553394 币种：人民币 流水单号：AOFC001006134243338
交易日期 币种 钞汇 业务摘要 发生额 余额 对方户名 对方账号
2026-03-29 人民币 汇 个贷还款 -6554.36 4431.41
2026-02-13 人民币 汇 还款 -684.58 5098.95`,
    ],
    "bank-of-beijing-statement.txt",
    { type: "text/plain" },
  );

  const result = await analyzeLedgerFile(file, { fallbackYear: 2026 });

  assert.equal(result.mode, "local");
  assert.equal(result.statementType, "bank-of-beijing");
  assert.deepEqual(result.accountCandidate, {
    institution: "北京银行",
    accountName: "北京银行 尾号3394",
    accountNumberLast4: "3394",
    accountFingerprint: "bank-of-beijing:3394",
    openingBalanceEstimate: 5783.53,
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
        category: "其他收入",
        source: "file",
      },
      {
        date: "2026-03-06",
        description: "掌上生活还款回馈金",
        amount: 3,
        direction: "income",
        category: "退款",
        source: "file",
      },
      {
        date: "2026-03-01",
        description: "增值服务使用费-用卡安全保障",
        amount: -5,
        direction: "expense",
        category: "其他支出",
        source: "file",
      },
      {
        date: "2026-03-02",
        description: "财付通-虎头军煎饼（鼎成中心店）",
        amount: 14,
        direction: "income",
        category: "其他收入",
        source: "file",
      },
      {
        date: "2026-02-23",
        description: "朝朝宝",
        amount: -31.74,
        direction: "expense",
        category: "其他支出",
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
