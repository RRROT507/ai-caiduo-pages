import { inferCategory, parseLedgerText, roundMoney } from "./ledger-core.mjs";

const PDF_TYPE = "application/pdf";
const TEXT_LIKE_EXTENSIONS = [".txt", ".csv", ".tsv", ".ofx", ".qfx"];

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

  if (options.endpoint) {
    try {
      const aiTransactions = await analyzeWithEndpoint(file, extractedText, options);
      if (aiTransactions.length > 0) {
        return {
          transactions: aiTransactions,
          mode: "ai",
          message: "AI 已生成预览",
        };
      }
    } catch {
      // Fall back to local parsing when a configured AI endpoint is temporarily unavailable.
    }
  }

  const localTransactions = parseLedgerText(extractedText, { fallbackYear }).map((transaction) => ({
    ...transaction,
    source: "file",
  }));

  if (localTransactions.length > 0) {
    return {
      transactions: localTransactions,
      mode: "local",
      message: "已使用本地解析生成预览",
    };
  }

  return {
    transactions: [],
    mode: options.endpoint ? "empty" : "needs-ai-backend",
    message:
      file.type === PDF_TYPE || getFileExtension(file.name) === ".pdf"
        ? "这个 PDF 需要接入 AI/OCR 服务后识别"
        : "没有识别到可导入交易",
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
  const bytes = new Uint8Array(await file.arrayBuffer());
  const raw = new TextDecoder("latin1").decode(bytes);
  const textFragments = [];

  for (const match of raw.matchAll(/\((?:\\.|[^\\)])*\)/gu)) {
    textFragments.push(unescapePdfLiteral(match[0].slice(1, -1)));
  }

  for (const match of raw.matchAll(/<([0-9A-Fa-f]{8,})>/gu)) {
    const decoded = decodePdfHexString(match[1]);
    if (decoded) {
      textFragments.push(decoded);
    }
  }

  const looseUtf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const visibleLooseText = looseUtf8
    .replace(/[^\p{Letter}\p{Number}\p{Punctuation}\p{Separator}\n.-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (visibleLooseText) {
    textFragments.push(visibleLooseText);
  }

  return textFragments.join("\n");
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

  return Number(String(value ?? "").replace(/[¥,\s]/gu, ""));
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

function unescapePdfLiteral(value) {
  return value
    .replace(/\\n/gu, "\n")
    .replace(/\\r/gu, "\n")
    .replace(/\\t/gu, "\t")
    .replace(/\\([()\\])/gu, "$1")
    .trim();
}

function decodePdfHexString(hex) {
  const bytes = [];
  for (let index = 0; index < hex.length - 1; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes.slice(2)).trim();
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes)).trim();
}

function decodeUtf16Be(bytes) {
  let output = "";
  for (let index = 0; index < bytes.length - 1; index += 2) {
    output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }
  return output;
}
