import {
  inferCategory,
  isFallbackCategory,
  normalizeTransactionCategory,
  normalizeTransactionType,
  parseLedgerText,
  recommendCategory,
  roundMoney,
} from "./ledger-core.mjs";

const PDF_TYPE = "application/pdf";
const TEXT_LIKE_EXTENSIONS = [".txt", ".csv", ".tsv", ".ofx", ".qfx"];
const CMB_INSTITUTION = "招商银行";
const CMB_TRANSACTION_STATEMENT_PATTERN =
  /招商银行交易流水|Transaction Statement of China Merchants Bank/u;
const CMB_CREDIT_CARD_PATTERN = /招商银行信用卡对账单|CMB Credit Card Statement/u;
const ALIPAY_STATEMENT_PATTERN = /支付宝支付科技有限公司|交易流水证明|收\/付款方式/u;

export async function analyzeLedgerFile(file, options = {}) {
  if (!file) {
    return {
      transactions: [],
      mode: "empty",
      message: "请先选择账单文件",
    };
  }

  const fallbackYear = Number(options.fallbackYear) || new Date().getFullYear();
  const extractedText = await extractTextFromFile(file);
  const localResult = parseLocalStatementText(extractedText, { fallbackYear });
  const localReconciliationItems = localResult.reconciliationItems || [];
  const localSkippedItems = localResult.skippedItems || [];
  const hasAlipayReviewItems = localReconciliationItems.length > 0 || localSkippedItems.length > 0;

  if (options.endpoint && !hasAlipayReviewItems) {
    try {
      const aiTransactions = await analyzeWithEndpoint(file, extractedText, options);
      if (aiTransactions.length > 0) {
        return {
          transactions: aiTransactions,
          accountCandidate: localResult.accountCandidate,
          reconciliationItems: localReconciliationItems,
          skippedItems: localSkippedItems,
          mode: "ai",
          message: "AI 已生成预览",
        };
      }
    } catch {
      // Fall back to local parsing when a configured AI endpoint is temporarily unavailable.
    }
  }

  const localTransactions = localResult.transactions;

  if (localTransactions.length > 0 || hasAlipayReviewItems) {
    return {
      transactions: localTransactions,
      accountCandidate: localResult.accountCandidate,
      reconciliationItems: localReconciliationItems,
      skippedItems: localSkippedItems,
      mode: "local",
      message: "已使用本地解析生成预览",
    };
  }

  return {
    transactions: [],
    reconciliationItems: localReconciliationItems,
    skippedItems: localSkippedItems,
    accountCandidate: localResult.accountCandidate,
    mode: options.endpoint ? "empty" : "needs-ai-backend",
    message:
      file.type === PDF_TYPE || getFileExtension(file.name) === ".pdf"
        ? "这个 PDF 暂未识别出可入账交易，需要接入 AI/OCR 服务后识别"
        : "没有识别到可导入交易",
  };
}

export function parseCmbCreditCardStatement(text, options = {}) {
  const statement = getStatementYearMonth(text, options.fallbackYear);
  const rows = [];

  for (const rawLine of String(text).split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+/gu, " ").trim();
    const parsed = parseCmbTransactionLine(line, statement);
    if (parsed) {
      rows.push(parsed);
    }
  }

  const transactions = rows.map(({ cardNumberLast4, ...transaction }) => transaction);
  return {
    transactions,
    accountCandidate: buildCmbCreditCardAccountCandidate(rows),
  };
}

export function parseCmbCreditCardStatementText(text, options = {}) {
  return parseCmbCreditCardStatement(text, options).transactions;
}

export function parseCmbTransactionStatement(text) {
  const rows = [];

  for (const rawLine of String(text).split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+/gu, " ").trim();
    const parsed = parseCmbTransactionStatementLine(line);
    if (parsed) {
      rows.push(parsed);
    }
  }

  const transactions = rows.map(({ statementBalance, ...transaction }) => transaction);
  return {
    transactions,
    accountCandidate: buildCmbAccountCandidate(text, rows),
  };
}

export function parseCmbTransactionStatementText(text) {
  return parseCmbTransactionStatement(text).transactions;
}

function parseLocalStatementText(text, options) {
  if (!text.trim()) {
    return { transactions: [], accountCandidate: null };
  }

  if (ALIPAY_STATEMENT_PATTERN.test(text)) {
    return parseAlipayStatement(text, options);
  }

  if (CMB_TRANSACTION_STATEMENT_PATTERN.test(text)) {
    return parseCmbTransactionStatement(text);
  }

  if (CMB_CREDIT_CARD_PATTERN.test(text)) {
    return parseCmbCreditCardStatement(text, options);
  }

  return {
    transactions: parseLedgerText(text, { fallbackYear: options.fallbackYear }).map(
      (transaction) => ({
        ...transaction,
        source: "file",
      }),
    ),
    accountCandidate: null,
  };
}

export function classifyAlipayPaymentMethod(methodText) {
  const normalizedMethod = normalizeAlipayCell(methodText);
  if (!normalizedMethod) {
    return { scope: "unknown", normalizedMethod, candidate: null };
  }

  if (/^(?:支付宝|支付宝余额|余额)$/u.test(normalizedMethod)) {
    return { scope: "alipay-account", normalizedMethod, candidate: null };
  }

  const suffixMatch = normalizedMethod.match(/[（(](\d{4})[）)]/u);
  const accountNumberLast4 = suffixMatch ? suffixMatch[1] : "";
  if (/银行|信用卡|储蓄卡|银行卡/u.test(normalizedMethod)) {
    const institution = normalizedMethod.includes("招商银行") ? "招商银行" : "";
    const accountKind = normalizedMethod.includes("信用卡") ? "credit-card" : "bank-card";
    const prefix = institution === "招商银行" && accountKind === "credit-card" ? "cmb-credit-card" : "bank-card";
    return {
      scope: "bank-account",
      normalizedMethod,
      candidate: {
        institution,
        accountKind,
        accountNumberLast4,
        accountFingerprint: accountNumberLast4 ? `${prefix}:${accountNumberLast4}` : "",
        displayName: `${institution || "银行卡"}${accountKind === "credit-card" ? "信用卡" : ""}${
          accountNumberLast4 ? ` 尾号${accountNumberLast4}` : ""
        }`.trim(),
      },
    };
  }

  return { scope: "unknown", normalizedMethod, candidate: null };
}

export function parseAlipayStatement(text, options = {}) {
  const rows = parseAlipayRows(text);
  const transactions = [];
  const reconciliationItems = [];
  const skippedItems = [];

  for (const row of rows) {
    const parsed = normalizeAlipayRow(row);
    if (!parsed) {
      continue;
    }
    if (parsed.skipReason) {
      skippedItems.push(parsed);
      continue;
    }
    if (parsed.paymentScope === "alipay-account") {
      transactions.push(toAlipayTransaction(parsed));
    } else if (parsed.paymentScope === "bank-account") {
      reconciliationItems.push(toAlipayReconciliationItem(parsed));
    } else {
      skippedItems.push({ ...parsed, skipReason: "unsupported-payment-method" });
    }
  }

  return {
    transactions,
    reconciliationItems,
    skippedItems,
    accountCandidate: null,
  };
}

function parseAlipayRows(text) {
  const lines = String(text)
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
  const rows = [];
  let block = [];

  for (const line of lines) {
    if (/^(?:支出|收入|不计\s*收支)\s+/u.test(line)) {
      if (block.length > 0) {
        rows.push(parseAlipayBlock(block));
      }
      block = [line];
    } else if (block.length === 0 && line.split(/\s+/u).length === 1 && line.length <= 4) {
      block = [line];
    } else if (block.length > 0) {
      block.push(line);
    }
  }
  if (block.length > 0) {
    rows.push(parseAlipayBlock(block));
  }

  return rows.filter(Boolean);
}

function parseAlipayBlock(block) {
  const clean = block.join(" ").replace(/\s+/gu, " ").trim();
  const cleanMatch = clean.match(
    /^(支出|收入|不计\s*收支)\s+(.+?)\s+(.+?)\s+(.+?)\s+([-+]?\d[\d,]*\.\d{2})\s+\S+\s+\S+\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?/u,
  );
  if (cleanMatch) {
    return buildAlipayRow({
      status: cleanMatch[1],
      counterparty: cleanMatch[2],
      product: cleanMatch[3],
      paymentMethod: cleanMatch[4],
      amount: cleanMatch[5],
      date: cleanMatch[6],
      time: cleanMatch[7],
    });
  }

  const dateMatch = clean.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}:\d{2}))?/u);
  const amountMatches = [...clean.matchAll(/[-+]?\d[\d,]*\.\d{2}/gu)];
  const methodMatch = clean.match(/(支付宝余额|支付宝|余额|[^\s]+银行[^\s]+(?:信用卡|储蓄卡|银行卡)?(?:[（(]\d{4}[）)])?)/u);
  if (!dateMatch || amountMatches.length === 0) {
    return null;
  }

  const statusMatch = clean.match(/^(支出|收入|不计\s*收支)\s+/u);
  const rowStart = statusMatch ? statusMatch[0].length : 0;
  const amountIndex = amountMatches[0].index;
  const fieldsBeforeAmount = clean.slice(rowStart, amountIndex).trim().split(/\s+/u).filter(Boolean);
  if (!methodMatch && fieldsBeforeAmount.length < 3) {
    return null;
  }

  const beforeMethod = methodMatch
    ? clean.slice(rowStart, methodMatch.index).trim()
    : fieldsBeforeAmount.slice(0, -1).join(" ");
  const fields = beforeMethod.split(/\s+/u).filter(Boolean);
  const paymentMethod = methodMatch ? methodMatch[1] : fieldsBeforeAmount.at(-1);
  return buildAlipayRow({
    status: statusMatch ? statusMatch[1] : "支出",
    counterparty: fields[0] || "",
    product: fields.slice(1).join(" "),
    paymentMethod,
    amount: amountMatches[amountMatches.length - 1][0],
    date: dateMatch[1],
    time: dateMatch[2],
  });
}

function buildAlipayRow({ status, counterparty, product, paymentMethod, amount, date, time }) {
  const normalizedDate = normalizeDate(date);
  const parsedAmount = parseAmount(amount);
  if (!normalizedDate || !Number.isFinite(parsedAmount)) {
    return null;
  }

  const direction = status === "收入" ? "income" : "expense";
  const signedAmount = parsedAmount === 0
    ? 0
    : direction === "income"
      ? Math.abs(parsedAmount)
      : -Math.abs(parsedAmount);
  const payment = classifyAlipayPaymentMethod(paymentMethod);
  return {
    date: normalizedDate,
    counterparty: normalizeAlipayDisplayText(counterparty),
    product: normalizeAlipayDisplayText(product),
    paymentMethod: payment.normalizedMethod,
    amount: roundMoney(signedAmount),
    direction,
    category: inferCategory(buildAlipayDescription(counterparty, product), direction),
    paymentScope: payment.scope,
    paymentAccountCandidate: payment.candidate,
    description: buildAlipayDescription(counterparty, product),
    source: "file",
    ...(parsedAmount === 0
      ? { skipReason: "zero-amount" }
      : status === "不计收支"
        ? { skipReason: "excluded-by-statement" }
        : {}),
    ...(time ? { time } : {}),
  };
}

function normalizeAlipayRow(row) {
  return row;
}

function toAlipayTransaction(row) {
  const { paymentScope, paymentAccountCandidate, paymentMethod, counterparty, product, time, skipReason, ...transaction } = row;
  return transaction;
}

function toAlipayReconciliationItem(row) {
  const { paymentScope, description, source, time, skipReason, ...item } = row;
  return item;
}

function normalizeAlipayCell(value) {
  return String(value || "").replace(/\s+/gu, "").trim();
}

function normalizeAlipayDisplayText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function buildAlipayDescription(counterparty, product) {
  const parts = [counterparty, product]
    .map((part) => normalizeAlipayDisplayText(part))
    .filter(Boolean);
  return [...new Set(parts)].join(" - ");
}

async function analyzeWithEndpoint(file, extractedText, options) {
  const formData = new FormData();
  formData.append("file", file, file.name || "statement");
  formData.append("text", extractedText);
  formData.append("fallbackYear", String(Number(options.fallbackYear) || new Date().getFullYear()));

  const response = await fetch(options.endpoint, {
    method: "POST",
    body: formData,
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`AI import failed: ${response.status}`);
  }

  const payload = await response.json();
  const rawTransactions = Array.isArray(payload) ? payload : payload.transactions || [];

  return rawTransactions
    .map((transaction) => normalizeAiTransaction(transaction))
    .filter(Boolean);
}

async function extractTextFromFile(file) {
  const extension = getFileExtension(file.name);
  if (file.type === PDF_TYPE || extension === ".pdf") {
    return extractTextFromPdf(file);
  }

  if (file.type.startsWith("text/") || TEXT_LIKE_EXTENSIONS.includes(extension)) {
    return file.text();
  }

  try {
    return await file.text();
  } catch {
    return "";
  }
}

async function extractTextFromPdf(file) {
  if (typeof DOMMatrix === "undefined") {
    return "";
  }

  try {
    const pdfjs = await import("./vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "./vendor/pdfjs/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();

    const document = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(textContentToLines(content).join("\n"));
    }

    return pages.join("\n");
  } catch {
    return "";
  }
}

function textContentToLines(content) {
  const rows = new Map();

  for (const item of content.items || []) {
    const text = String(item.str || "").trim();
    if (!text) {
      continue;
    }

    const transform = item.transform || [];
    const x = Number(transform[4]) || 0;
    const y = Math.round(Number(transform[5]) || 0);
    const row = rows.get(y) || [];
    row.push({ x, text });
    rows.set(y, row);
  }

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(" ")
        .replace(/\s+/gu, " ")
        .trim(),
    )
    .filter(Boolean);
}

function parseCmbTransactionStatementLine(line) {
  const match = line.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+[A-Z]{3}\s+([-+]?\d[\d,]*\.\d{2})\s+([-+]?\d[\d,]*\.\d{2})(?:\s+(.+))?$/u,
  );
  if (!match) {
    return null;
  }

  const amount = parseAmount(match[4]);
  const statementBalance = parseAmount(match[5]);
  if (!Number.isFinite(amount) || amount === 0) {
    return null;
  }

  const direction = amount < 0 ? "expense" : "income";
  const signedAmount = direction === "expense" ? -Math.abs(amount) : Math.abs(amount);
  const description = String(match[6] || "招商银行交易").trim();

  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    description,
    amount: roundMoney(signedAmount),
    direction,
    category: inferCategory(description, direction),
    source: "file",
    statementBalance: Number.isFinite(statementBalance) ? roundMoney(statementBalance) : null,
  };
}

function buildCmbAccountCandidate(text, rows) {
  const accountNumber = findCmbStatementAccountNumber(text);
  if (!accountNumber) {
    return null;
  }

  const accountNumberLast4 = accountNumber.slice(-4);
  const firstRowWithBalance = rows.find((row) => Number.isFinite(row.statementBalance));
  const openingBalanceEstimate = firstRowWithBalance
    ? roundMoney(firstRowWithBalance.statementBalance - firstRowWithBalance.amount)
    : 0;

  return {
    institution: CMB_INSTITUTION,
    accountName: `${CMB_INSTITUTION} 尾号${accountNumberLast4}`,
    accountNumberLast4,
    accountFingerprint: `cmb:${accountNumberLast4}`,
    openingBalanceEstimate,
  };
}

function buildCmbCreditCardAccountCandidate(rows) {
  const cardNumbers = [
    ...new Set(
      rows
        .map((row) => String(row.cardNumberLast4 || "").trim())
        .filter((value) => /^\d{4}$/u.test(value)),
    ),
  ].sort();
  if (cardNumbers.length === 0) {
    return null;
  }

  const accountNumberLast4 = cardNumbers.join("/");
  return {
    institution: CMB_INSTITUTION,
    accountName: `${CMB_INSTITUTION}信用卡 尾号${accountNumberLast4}`,
    accountNumberLast4,
    accountFingerprint: `cmb-credit-card:${cardNumbers.join("-")}`,
    openingBalanceEstimate: 0,
  };
}

function findCmbStatementAccountNumber(text) {
  const beforeTransactions =
    String(text).split(/\n(?=\d{4}-\d{2}-\d{2}\s+[A-Z]{3}\s+)/u)[0] || "";
  const candidates = [...beforeTransactions.matchAll(/\b\d{12,24}\b/gu)].map(
    (match) => match[0],
  );
  return candidates[0] || "";
}

function parseCmbTransactionLine(line, statement) {
  const match = line.match(
    /^(\d{2})\/(\d{2})(?:\s+\d{2}\/\d{2})?\s+(.+?)\s+([-+]?\d[\d,]*\.\d{2})\s+(\d{4})\s+[-+]?\d[\d,]*\.\d{2}(?:\s|$)/u,
  );
  if (!match) {
    return null;
  }

  const description = match[3].trim();
  if (!description) {
    return null;
  }

  const amount = parseAmount(match[4]);
  if (!Number.isFinite(amount) || amount === 0) {
    return null;
  }

  const direction = getCmbCreditCardTransactionDirection(amount);
  const signedAmount = direction === "expense" ? -Math.abs(amount) : Math.abs(amount);

  return {
    date: formatMonthDay(statement, match[1], match[2]),
    description,
    amount: roundMoney(signedAmount),
    direction,
    category: inferCategory(description, direction),
    source: "file",
    cardNumberLast4: match[5],
  };
}

function getCmbCreditCardTransactionDirection(amount) {
  return amount >= 0 ? "expense" : "income";
}

function getStatementYearMonth(text, fallbackYear) {
  const chineseMatch = String(text).match(/(\d{4})年(\d{1,2})月/u);
  if (chineseMatch) {
    return {
      year: Number(chineseMatch[1]),
      month: Number(chineseMatch[2]),
    };
  }

  const dottedMatch = String(text).match(/(?:Statement\s*)?\((\d{4})\.(\d{1,2})\)/iu);
  if (dottedMatch) {
    return {
      year: Number(dottedMatch[1]),
      month: Number(dottedMatch[2]),
    };
  }

  return {
    year: Number(fallbackYear) || new Date().getFullYear(),
    month: new Date().getMonth() + 1,
  };
}

function formatMonthDay(statement, monthText, dayText) {
  const month = Number(monthText);
  const day = Number(dayText);
  const year = month > statement.month ? statement.year - 1 : statement.year;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeAiTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") {
    return null;
  }

  const date = normalizeDate(transaction.date);
  const description = String(
    transaction.description || transaction.summary || transaction.merchant || transaction.name || "",
  ).trim();
  const amount = parseAmount(transaction.amount ?? transaction.value);

  if (!date || !description || !Number.isFinite(amount) || amount === 0) {
    return null;
  }

  const transactionType = normalizeTransactionType(transaction.type);
  const isTransfer = transactionType === "transfer";
  const direction = isTransfer
    ? amount >= 0
      ? "income"
      : "expense"
    : transaction.direction === "income" || transaction.type === "income" || amount > 0
      ? "income"
      : "expense";
  const signedAmount = direction === "income" ? Math.abs(amount) : -Math.abs(amount);
  const categoryType = isTransfer ? "transfer" : direction;
  const normalizedCategory = normalizeTransactionCategory(
    transaction.category,
    categoryType,
    description,
  );
  const recommendation = recommendCategory(description, categoryType);
  const category =
    isFallbackCategory(normalizedCategory, categoryType) &&
    recommendation.source === "rule" &&
    recommendation.confidence === "high"
      ? recommendation.category
      : normalizedCategory;

  return {
    date,
    description,
    amount: roundMoney(signedAmount),
    direction,
    ...(isTransfer ? { type: "transfer", transferMatch: "explicit" } : {}),
    category,
    source: "ai",
  };
}

function parseAmount(value) {
  if (typeof value === "number") {
    return value;
  }

  return Number(String(value ?? "").replace(/[¥￥,\s]/gu, ""));
}

function normalizeDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/u);
  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function getFileExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.[^.]+$/u);
  return match ? match[0] : "";
}
