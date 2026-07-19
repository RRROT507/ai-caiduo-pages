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
const STATEMENT_META_PATTERN = /账单周期|账单期间|统计期间|起止日期|起始日期|结束日期|年账单|月账单/u;

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
  const typedTransactions = tagTransferTransactions(transactions);
  const selectedTransactions = filterLedgerTransactions(typedTransactions, filters);
  const cashFlowTransactions = selectedTransactions.filter(
    (transaction) => transaction.type !== "transfer",
  );

  const income = roundMoney(
    cashFlowTransactions
      .filter((transaction) => Number(transaction.amount) > 0)
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0),
  );
  const expense = roundMoney(
    cashFlowTransactions
      .filter((transaction) => Number(transaction.amount) < 0)
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount)), 0),
  );
  const categoryMap = new Map();

  for (const transaction of cashFlowTransactions) {
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

export function tagTransferTransactions(transactions) {
  const items = transactions.map((transaction, index) => ({
    transaction,
    index,
    amount: roundMoney(Number(transaction.amount)),
    accountId: String(transaction.accountId || "").trim(),
    date: String(transaction.date || ""),
  }));
  const groups = new Map();

  for (const item of items) {
    if (
      !item.accountId ||
      item.accountId === UNASSIGNED_ACCOUNT_ID ||
      !isDateKey(item.date) ||
      !Number.isFinite(item.amount) ||
      item.amount === 0
    ) {
      continue;
    }

    const key = `${item.date}|${Math.abs(item.amount).toFixed(2)}`;
    const group = groups.get(key) || { income: [], expense: [] };
    if (item.amount > 0) {
      group.income.push(item);
    } else {
      group.expense.push(item);
    }
    groups.set(key, group);
  }

  const transferIndexes = new Set();
  for (const group of groups.values()) {
    const usedIncomeIndexes = new Set();
    for (const expenseItem of group.expense) {
      const incomeIndex = group.income.findIndex(
        (incomeItem, index) =>
          !usedIncomeIndexes.has(index) && incomeItem.accountId !== expenseItem.accountId,
      );
      if (incomeIndex < 0) {
        continue;
      }

      usedIncomeIndexes.add(incomeIndex);
      transferIndexes.add(expenseItem.index);
      transferIndexes.add(group.income[incomeIndex].index);
    }
  }

  return transactions.map((transaction, index) => {
    const shouldBeTransfer = transferIndexes.has(index);
    if (shouldBeTransfer) {
      return transaction.type === "transfer" ? transaction : { ...transaction, type: "transfer" };
    }
    if (transaction.type !== "transfer") {
      return transaction;
    }

    const { type, ...withoutType } = transaction;
    return withoutType;
  });
}

export function filterLedgerTransactions(transactions, filters = {}) {
  const months = new Set((filters.months || []).filter(Boolean));
  const accountIds = new Set((filters.accountIds || []).filter(Boolean));
  const startDate = isDateKey(filters.startDate) ? filters.startDate : "";
  const endDate = isDateKey(filters.endDate) ? filters.endDate : "";
  const shouldFilterMonths = months.size > 0 && !startDate && !endDate;
  const shouldFilterDates = Boolean(startDate || endDate);
  const shouldFilterAccounts = accountIds.size > 0;

  return transactions.filter((transaction) => {
    const date = String(transaction.date || "");
    const transactionMonth = date.slice(0, 7);
    const accountId = transaction.accountId || UNASSIGNED_ACCOUNT_ID;

    return (
      (!shouldFilterMonths || months.has(transactionMonth)) &&
      (!shouldFilterDates || isWithinDateRange(date, startDate, endDate)) &&
      (!shouldFilterAccounts || accountIds.has(accountId))
    );
  });
}

export function calculateRunningBalances(transactions, options = {}) {
  const openingBalanceByAccountId = options.openingBalanceByAccountId || {};
  const accountBalances = new Map(
    Object.entries(openingBalanceByAccountId).map(([accountId, amount]) => [
      accountId,
      roundMoney(toFiniteMoney(amount)),
    ]),
  );
  const transactionBalances = new Map();

  const orderedTransactions = transactions
    .map((transaction, index) => ({
      transaction,
      index,
      accountId: transaction.accountId || UNASSIGNED_ACCOUNT_ID,
      amount: Number(transaction.amount),
    }))
    .filter((item) => Number.isFinite(item.amount))
    .sort(compareTransactionsAscending);

  for (const item of orderedTransactions) {
    const previousBalance = accountBalances.get(item.accountId) || 0;
    const nextBalance = roundMoney(previousBalance + item.amount);
    accountBalances.set(item.accountId, nextBalance);

    if (item.transaction.id) {
      transactionBalances.set(item.transaction.id, nextBalance);
    }
  }

  return { transactionBalances, accountBalances };
}

export function compareLedgerTransactionsDescending(a, b) {
  return compareTransactionValues(b, a);
}

export function toCsv(transactions, options = {}) {
  const accountNameById = options.accountNameById || {};
  const rows = transactions.map((transaction) => {
    const accountId = transaction.accountId || UNASSIGNED_ACCOUNT_ID;
    const accountName = accountNameById[accountId] || UNASSIGNED_ACCOUNT_NAME;

    return [
      transaction.date,
      accountName,
      transaction.type === "transfer"
        ? "转账"
        : transaction.direction === "income"
          ? "收入"
          : "支出",
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

function isWithinDateRange(date, startDate, endDate) {
  if (!isDateKey(date)) {
    return false;
  }

  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function isDateKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function compareTransactionsAscending(a, b) {
  return (
    compareTransactionValues(a.transaction, b.transaction) ||
    a.index - b.index
  );
}

function compareTransactionValues(a, b) {
  return (
    String(a.date || "").localeCompare(String(b.date || "")) ||
    String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
    getTransactionSequence(a) - getTransactionSequence(b)
  );
}

function getTransactionSequence(transaction) {
  const sequence = Number(transaction.sequence);
  return Number.isFinite(sequence) ? sequence : 0;
}

function toFiniteMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

function parseLine(line, fallbackYear) {
  const originalLine = String(line).trim();
  if (!originalLine || SKIP_PATTERN.test(originalLine) || STATEMENT_META_PATTERN.test(originalLine)) {
    return null;
  }

  const dateMatch = findDate(originalLine, fallbackYear);
  if (!dateMatch) {
    return null;
  }

  const withoutDate = stripSecondaryDates(originalLine.replace(dateMatch.raw, " "));
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
    const date = formatDate(fullDate[1], fullDate[2], fullDate[3]);
    if (!isDateKey(date)) {
      return null;
    }
    return {
      raw: fullDate[0],
      date,
    };
  }

  const partialDate = line.match(/(?<!\d)(\d{1,2})[./-](\d{1,2})(?!\d)/u);
  if (partialDate) {
    const date = formatDate(String(fallbackYear), partialDate[1], partialDate[2]);
    if (!isDateKey(date)) {
      return null;
    }
    return {
      raw: partialDate[0],
      date,
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

function stripSecondaryDates(line) {
  return String(line)
    .replace(/(?<!\d)\d{4}[./-]\d{1,2}[./-]\d{1,2}(?!\d)/gu, " ")
    .replace(/(?<!\d)\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日?(?!\d)/gu, " ")
    .replace(/^\s*(?:至|到|-|—|–)?\s*\d{1,2}[/-]\d{1,2}(?!\d)/u, " ");
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
