const EXPENSE_CATEGORIES = ["餐饮", "交通", "购物", "居家", "医疗", "娱乐", "学习", "其他支出"];
const INCOME_CATEGORIES = ["工资", "奖金", "报销", "退款", "利息", "投资收益", "其他收入"];
const TRANSFER_CATEGORIES = ["转账"];
const REFUNDED_CATEGORIES = ["已退款"];

const CATEGORY_OPTIONS_BY_TYPE = {
  expense: EXPENSE_CATEGORIES,
  income: INCOME_CATEGORIES,
  transfer: TRANSFER_CATEGORIES,
  refunded: REFUNDED_CATEGORIES
};

const TRANSACTION_TYPES = [
  { value: "expense", label: "支出" },
  { value: "income", label: "收入" },
  { value: "transfer", label: "转账" },
  { value: "refunded", label: "已退款" }
];

const EXPENSE_CATEGORY_RULES = [
  ["餐饮", /餐厅|餐饮|早餐|午餐|晚餐|饭店|饭馆|面馆|面包|煎饼|小吃|水饺|饺子|烧烤|咖啡|外卖|美团外卖|饿了么|PIZZA\s*HUT|PIZZAHUT|必胜客|KFC|肯德基|麦当劳|汉堡王|华莱士|喜家德|星巴克|瑞幸|海底捞|蜜雪冰城|火锅|奶茶|茶饮|喜茶|奈雪/iu],
  ["交通", /地铁|公交|滴滴|打车|高德|加油|停车|停车费|停车场|车场|停简单|ETC|etc|通行费|高速公路|高速费|过路费|高速信联|铁路|火车|机票|航旅/u],
  ["购物", /淘宝|天猫|京东|拼多多|超市|便利店|商场|购物|小米|苹果|抖音商城|果蔬好|生鲜超市|水果店|蔬菜/u],
  ["居家", /房租|物业|水费|电费|燃气|宽带|话费|移动|联通|电信/u],
  ["医疗", /医院|药|医保|挂号|体检|诊所/u],
  ["娱乐", /电影|音乐|游戏|会员|视频|旅游|酒店|景区/u],
  ["学习", /课程|教育|培训|知识|考试|学费|教材|图书|书店|书籍|文具/u]
];

const INCOME_CATEGORY_RULES = [
  ["工资", /工资|薪资|薪水|劳务|薪酬|津贴|补贴/u],
  ["奖金", /奖金|奖励|年终奖|绩效|提成/u],
  ["报销", /报销/u],
  ["退款", /退款|退货|返现|回馈|冲正/u],
  ["利息", /利息|结息|朝朝宝|理财收益/u],
  ["投资收益", /投资|分红|股息|基金|证券|股票/u]
];

const UNASSIGNED_ACCOUNT_ID = "__unassigned__";
const UNASSIGNED_ACCOUNT_NAME = "未指定账户";

function normalizeTransactionType(type) {
  return type === "transfer" || type === "income" || type === "refunded" ? type : "expense";
}

function getTransactionType(transaction) {
  if (typeof transaction === "string") {
    return normalizeTransactionType(transaction);
  }
  if (transaction && transaction.type === "transfer") {
    return "transfer";
  }
  if (transaction && transaction.type === "refunded") {
    return "refunded";
  }
  return normalizeTransactionType(transaction && transaction.direction);
}

function getTransactionTypes() {
  return TRANSACTION_TYPES.map((transactionType) => ({ ...transactionType }));
}

function getTypeLabel(type) {
  const normalizedType = normalizeTransactionType(type);
  const item = TRANSACTION_TYPES.find((transactionType) => transactionType.value === normalizedType);
  return item ? item.label : "支出";
}

function getCategoriesForType(type) {
  return [...CATEGORY_OPTIONS_BY_TYPE[normalizeTransactionType(type)]];
}

function recommendCategory(description, type = "expense") {
  const normalizedType = normalizeTransactionType(type);
  const merchant = extractMerchantKey(description);

  if (normalizedType === "transfer") {
    return { category: "转账", confidence: "high", source: "transfer", merchant };
  }
  if (normalizedType === "refunded") {
    return { category: "已退款", confidence: "high", source: "refunded", merchant };
  }

  const rules = normalizedType === "income" ? INCOME_CATEGORY_RULES : EXPENSE_CATEGORY_RULES;
  for (const [category, pattern] of rules) {
    if (pattern.test(merchant || description || "")) {
      return { category, confidence: "high", source: "rule", merchant };
    }
  }

  return {
    category: normalizedType === "income" ? "其他收入" : "其他支出",
    confidence: "low",
    source: "fallback",
    merchant
  };
}

function extractMerchantKey(description) {
  return String(description || "")
    .replace(/\s+/gu, " ")
    .replace(/^(?:财付通|支付宝|微信支付|微信|云闪付|京东支付|抖音支付|美团支付|美团|大众点评)[\s\-_:：]+/u, "")
    .replace(/[（(][^（）()]*?(?:店|中心|分店|门店|号|楼|层|市|区|县|路|街|广场)[^（）()]*?[）)]/gu, "")
    .replace(/\b\d{4,}\b/gu, "")
    .replace(/尾号\d{2,4}/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeTransactionCategory(category, type = "expense", description = "") {
  const normalizedType = normalizeTransactionType(type);
  if (normalizedType === "transfer") {
    return "转账";
  }
  if (normalizedType === "refunded") {
    return "已退款";
  }

  const value = String(category || "").trim();
  const options = CATEGORY_OPTIONS_BY_TYPE[normalizedType];
  if (options.includes(value)) {
    return value;
  }

  return recommendCategory(description, normalizedType).category;
}

function normalizeLedgerTransaction(transaction) {
  const type = getTransactionType(transaction);
  const amount = Number(transaction && transaction.amount);
  const normalized = {
    ...transaction,
    amount: Number.isFinite(amount) ? roundMoney(amount) : 0,
    direction:
      type === "transfer" || type === "refunded"
        ? amount >= 0
          ? "income"
          : "expense"
        : type,
    category: normalizeTransactionCategory(transaction && transaction.category, type, transaction && transaction.description)
  };

  if (type === "transfer") {
    normalized.type = "transfer";
  } else if (type === "refunded") {
    normalized.type = "refunded";
  } else {
    delete normalized.type;
  }

  return normalized;
}

function summarizeSelection(transactions, filters = {}) {
  const selectedTransactions = filterLedgerTransactions(
    transactions.map(normalizeLedgerTransaction),
    filters
  );
  const cashFlowTransactions = selectedTransactions.filter((transaction) => {
    const type = getTransactionType(transaction);
    return type !== "transfer" && type !== "refunded";
  });

  const income = roundMoney(
    cashFlowTransactions
      .filter((transaction) => Number(transaction.amount) > 0)
      .reduce((sum, transaction) => sum + Number(transaction.amount), 0)
  );
  const expense = roundMoney(
    cashFlowTransactions
      .filter((transaction) => Number(transaction.amount) < 0)
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.amount)), 0)
  );
  const categoryMap = new Map();

  for (const transaction of cashFlowTransactions) {
    if (Number(transaction.amount) >= 0) {
      continue;
    }
    const category = normalizeTransactionCategory(
      transaction.category,
      getTransactionType(transaction),
      transaction.description
    );
    categoryMap.set(category, roundMoney((categoryMap.get(category) || 0) + Math.abs(Number(transaction.amount))));
  }

  return {
    income,
    expense,
    balance: roundMoney(income - expense),
    count: selectedTransactions.length,
    categoryTotals: [...categoryMap.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, "zh-CN"))
  };
}

function filterLedgerTransactions(transactions, filters = {}) {
  const accountId = filters.accountId || "all";
  const startDate = filters.startDate || "";
  const endDate = filters.endDate || "";

  return transactions.filter((transaction) => {
    const date = String(transaction.date || "");
    if (startDate && date < startDate) {
      return false;
    }
    if (endDate && date > endDate) {
      return false;
    }
    if (accountId !== "all" && (transaction.accountId || UNASSIGNED_ACCOUNT_ID) !== accountId) {
      return false;
    }
    return true;
  });
}

function calculateRunningBalances(transactions, options = {}) {
  const openingBalanceByAccountId = options.openingBalanceByAccountId || {};
  const accountBalances = new Map(
    Object.entries(openingBalanceByAccountId).map(([accountId, amount]) => [
      accountId,
      roundMoney(toFiniteMoney(amount))
    ])
  );
  const transactionBalances = new Map();
  const orderedTransactions = transactions
    .map((transaction, index) => ({
      transaction: normalizeLedgerTransaction(transaction),
      index,
      accountId: transaction.accountId || UNASSIGNED_ACCOUNT_ID,
      amount: Number(transaction.amount)
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

function compareLedgerTransactionsDescending(a, b) {
  const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
  if (dateCompare !== 0) {
    return dateCompare;
  }

  const createdCompare = getCreatedTime(b) - getCreatedTime(a);
  if (createdCompare !== 0) {
    return createdCompare;
  }

  return String(b.id || "").localeCompare(String(a.id || ""));
}

function compareTransactionsAscending(a, b) {
  const dateCompare = String(a.transaction.date || "").localeCompare(String(b.transaction.date || ""));
  if (dateCompare !== 0) {
    return dateCompare;
  }

  const createdCompare = getCreatedTime(a.transaction) - getCreatedTime(b.transaction);
  if (createdCompare !== 0) {
    return createdCompare;
  }

  return a.index - b.index;
}

function getCreatedTime(transaction) {
  const value = Date.parse(transaction.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function roundMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function toFiniteMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

module.exports = {
  UNASSIGNED_ACCOUNT_ID,
  UNASSIGNED_ACCOUNT_NAME,
  calculateRunningBalances,
  compareLedgerTransactionsDescending,
  filterLedgerTransactions,
  getCategoriesForType,
  getTransactionType,
  getTransactionTypes,
  getTypeLabel,
  normalizeLedgerTransaction,
  normalizeTransactionCategory,
  normalizeTransactionType,
  recommendCategory,
  roundMoney,
  summarizeSelection
};
