import { inferCategory, parseLedgerText, roundMoney } from "./ledger-core.mjs";

const PDF_TYPE = "application/pdf";
const TEXT_LIKE_EXTENSIONS = [".txt", ".csv", ".tsv", ".ofx", ".qfx"];
const CMB_INSTITUTION = "招商银行";
const CMB_TRANSACTION_STATEMENT_PATTERN =
  /招商银行交易流水|Transaction Statement of China Merchants Bank/u;
const CMB_CREDIT_CARD_PATTERN = /招商银行信用卡对账单|CMB Credit Card Statement/u;

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

  if (options.endpoint) {
    try {
      const aiTransactions = await analyzeWithEndpoint(file, extractedText, options);
      if (aiTransactions.length > 0) {
        return {
          transactions: aiTransactions,
          accountCandidate: localResult.accountCandidate,
          mode: "ai",
          message: "AI 已生成预览",
        };
      }
    } catch {
      // Fall back to local parsing when a configured AI endpoint is temporarily unavailable.
    }
  }

  const localTransactions = localResult.transactions;

  if (localTransactions.length > 0) {
    return {
      transactions: localTransactions,
      accountCandidate: localResult.accountCandidate,
      mode: "local",
      message: "已使用本地解析生成预览",
    };
  }

  return {
    transactions: [],
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

  const direction =
    transaction.direction === "income" || transaction.type === "income" || amount > 0
      ? "income"
      : "expense";
  const signedAmount = direction === "income" ? Math.abs(amount) : -Math.abs(amount);

  return {
    date,
    description,
    amount: roundMoney(signedAmount),
    direction,
    category: String(transaction.category || inferCategory(description, direction)).trim(),
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
