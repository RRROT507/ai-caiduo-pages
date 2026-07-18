import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { analyzeLedgerFile } from "../assets/ledger-importer.mjs";

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
