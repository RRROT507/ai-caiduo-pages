const CATEGORY_RULES = [
  ["餐饮", /餐|饭|咖啡|茶|外卖|美团|饿了么|星巴克|瑞幸|肯德基|麦当劳|火锅|奶茶/u],
  ["交通", /地铁|公交|滴滴|打车|高德|加油|停车|铁路|火车|机票|航旅/u],
  ["购物", /淘宝|天猫|京东|拼多多|超市|便利店|商场|购物|小米|苹果|抖音商城/u],
  ["居家", /房租|物业|水费|电费|燃气|宽带|话费|移动|联通|电信/u],
  ["医疗", /医院|药|医保|挂号|体检|诊所/u],
  ["娱乐", /电影|音乐|游戏|会员|视频|旅游|酒店|景区/u],
  ["学习", /课程|书|教育|培训|知识|考试/u],
];

export const UNASSIGNED_ACCOUNT_ID = "__unassigned__";
export const UNASSIGNED_ACCOUNT_NAME = "未指定账户";

const INCOME_PATTERN = /收入|入账|工资|奖金|退款|转入|报销|利息/u;
const EXPENSE_PATTERN = /支出|消费|付款|扣款|转出|支付|还款/u;
const SKIP_PATTERN = /交易日期|记账日期|摘要|金额|余额|本页|小计|合计|总计|币种/u;

export function inferCategory(description, direction = "expense") {
  if (direction === "income") {
    return "收入";
  }

  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(description)) {
      return category;
    }
  }

  return "其他";
}

export function parseLedgerText(text, options = {}) {
  const fallbackYear = Number(options.fallbackYear) || new Date().getFullYear();

  return String(text)
    .split(/\r?\n/u)
    .map((line) => parseLine(line, fallbackYear))
    .filter(Boolean);
}

export function summarizeMonth(transactions, monthKey) {
  return summarizeSelection(transactions, { months: [monthKey] });
}

export function summarizeSelection(transactions, filters = {}) {
  const selectedTransactions = filterLedgerTransactions(transactions, filters);

  const income = roundMoney(
    selectedTransactions
      .filter((transaction) => Number(transaction.amount) > 0)
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0),
  );
  const expense = roundMoney(
    selectedTransactions
      .filter((transaction) => Number(transaction.amount) < 0)
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount)), 0),
  );
  const categoryMap = new Map();

  for (const transaction of selectedTransactions) {
    if (Number(transaction.amount) >= 0) {
      continue;
    }

    const category = transaction.category || "其他";
    categoryMap.set(
      category,
      roundMoney((categoryMap.get(category) || 0) + Math.abs(Number(transaction.amount))),
    );
  }

  const categoryTotals = [...categoryMap.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "zh-CN"));

  return {
    income,
    expense,
    balance: roundMoney(income - expense),
    count: selectedTransactions.length,
    categoryTotals,
  };
}

export function filterLedgerTransactions(transactions, filters = {}) {
  const months = new Set((filters.months || []).filter(Boolean));
  const accountIds = new Set((filters.accountIds || []).filter(Boolean));
  const shouldFilterMonths = months.size > 0;
  const shouldFilterAccounts = accountIds.size > 0;

  return transactions.filter((transaction) => {
    const date = String(transaction.date || "");
    const transactionMonth = date.slice(0, 7);
    const accountId = transaction.accountId || UNASSIGNED_ACCOUNT_ID;

    return (
      (!shouldFilterMonths || months.has(transactionMonth)) &&
      (!shouldFilterAccounts || accountIds.has(accountId))
    );
  });
}

export function toCsv(transactions, options = {}) {
  const accountNameById = options.accountNameById || {};
  const rows = transactions.map((transaction) => {
    const accountId = transaction.accountId || UNASSIGNED_ACCOUNT_ID;
    const accountName = accountNameById[accountId] || UNASSIGNED_ACCOUNT_NAME;

    return [
      transaction.date,
      accountName,
      transaction.direction === "income" ? "收入" : "支出",
      transaction.category,
      transaction.description,
      Number(transaction.amount).toFixed(2),
      transaction.source || "manual",
    ];
  });

  return [["日期", "账户", "类型", "分类", "说明", "金额", "来源"], ...rows]
    .map((row) => row.map(escapeCsvField).join(","))
    .join("\n");
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function parseLine(line, fallbackYear) {
  const originalLine = String(line).trim();
  if (!originalLine || SKIP_PATTERN.test(originalLine)) {
    return null;
  }

  const dateMatch = findDate(originalLine, fallbackYear);
  if (!dateMatch) {
    return null;
  }

  const withoutDate = originalLine.replace(dateMatch.raw, " ");
  const amountMatch = findAmount(withoutDate);
  if (!amountMatch) {
    return null;
  }

  const direction = detectDirection(originalLine, amountMatch.value);
  const signedAmount =
    direction === "expense" ? -Math.abs(amountMatch.value) : Math.abs(amountMatch.value);
  const description = cleanDescription(withoutDate, amountMatch.raw);

  if (!description) {
    return null;
  }

  return {
    date: dateMatch.date,
    description,
    amount: signedAmount,
    direction,
    category: inferCategory(description, direction),
    source: "paste",
  };
}

function findDate(line, fallbackYear) {
  const fullDate = line.match(/(?<!\d)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/u);
  if (fullDate) {
    return {
      raw: fullDate[0],
      date: formatDate(fullDate[1], fullDate[2], fullDate[3]),
    };
  }

  const partialDate = line.match(/(?<!\d)(\d{1,2})[./-](\d{1,2})(?!\d)/u);
  if (partialDate) {
    return {
      raw: partialDate[0],
      date: formatDate(String(fallbackYear), partialDate[1], partialDate[2]),
    };
  }

  return null;
}

function findAmount(line) {
  const matches = [
    ...line.matchAll(/[-+]?¥?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/gu),
  ];
  const candidates = matches
    .map((match) => ({
      raw: match[0],
      value: Number(match[0].replace(/[¥,\s]/gu, "")),
    }))
    .filter((candidate) => Number.isFinite(candidate.value));

  return candidates[0] || null;
}

function detectDirection(line, amount) {
  if (EXPENSE_PATTERN.test(line)) {
    return "expense";
  }
  if (INCOME_PATTERN.test(line)) {
    return "income";
  }
  return Number(amount) < 0 ? "expense" : "income";
}

function cleanDescription(line, amountRaw) {
  return line
    .replace(amountRaw, " ")
    .replace(/(?:收入|支出|消费|付款|扣款|转出|转入)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[|,，;；]+$/u, "")
    .trim();
}

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function escapeCsvField(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/u.test(text)) {
    return `"${text.replace(/"/gu, '""')}"`;
  }
  return text;
}
