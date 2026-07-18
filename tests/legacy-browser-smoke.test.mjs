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
    await page.fill("#monthInput", "2026-07");
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
    assert.equal(await page.locator("#transactionRows tr").count(), 0);
    await page.click("#confirmImportButton");
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#transactionRows tr").count(), 4);
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
