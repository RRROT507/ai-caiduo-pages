import test from "node:test";
import assert from "node:assert/strict";

import { buildAlipayTransactionUpdates } from "../assets/alipay-reconciliation.mjs";

test("matches duplicate generic Alipay card rows when supplements are equivalent", () => {
  let nextId = 0;
  const accounts = [
    {
      id: "credit-1755",
      name: "招商银行信用卡 尾号1755",
      institution: "招商银行",
      accountNumberLast4: "1755",
      accountFingerprint: "cmb-credit-card:1755",
    },
  ];
  const transactions = [
    {
      id: "cmb-etc-a",
      date: "2026-03-18",
      description: "支付宝-支付宝支付科技有限公司",
      amount: -4.75,
      direction: "expense",
      category: "其他支出",
      accountId: "credit-1755",
    },
    {
      id: "cmb-etc-b",
      date: "2026-03-18",
      description: "支付宝-支付宝支付科技有限公司",
      amount: -4.75,
      direction: "expense",
      category: "其他支出",
      accountId: "credit-1755",
    },
  ];
  const reconciliationItems = [
    {
      date: "2026-03-18",
      counterparty: "山东高速信联",
      product: "ETC通行费",
      paymentMethod: "招商银行信用卡(1755)",
      amount: -4.75,
      direction: "expense",
      paymentAccountCandidate: {
        institution: "招商银行",
        accountNumberLast4: "1755",
        accountFingerprint: "cmb-credit-card:1755",
        displayName: "招商银行信用卡 尾号1755",
      },
    },
    {
      date: "2026-03-18",
      counterparty: "山东高速信联",
      product: "ETC通行费",
      paymentMethod: "招商银行信用卡(1755)",
      amount: -4.75,
      direction: "expense",
      paymentAccountCandidate: {
        institution: "招商银行",
        accountNumberLast4: "1755",
        accountFingerprint: "cmb-credit-card:1755",
        displayName: "招商银行信用卡 尾号1755",
      },
    },
  ];

  const result = buildAlipayTransactionUpdates({
    accounts,
    transactions,
    reconciliationItems,
    categoryHistory: new Map(),
    createPreviewId: () => `preview-${++nextId}`,
  });

  assert.deepEqual(result.notices, []);
  assert.equal(result.updates.length, 2);
  assert.deepEqual(
    result.updates.map((update) => [update.targetId, update.nextCategory, update.nextDescription]).sort(),
    [
      ["cmb-etc-a", "交通", "支付宝-支付宝支付科技有限公司；支付宝补充：山东高速信联 - ETC通行费"],
      ["cmb-etc-b", "交通", "支付宝-支付宝支付科技有限公司；支付宝补充：山东高速信联 - ETC通行费"],
    ],
  );
});
