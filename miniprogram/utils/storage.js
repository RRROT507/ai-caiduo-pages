const { normalizeLedgerTransaction, roundMoney } = require("./ledger-core");

const TRANSACTIONS_STORAGE_KEY = "ai-caiduo-miniprogram-transactions-v1";
const ACCOUNTS_STORAGE_KEY = "ai-caiduo-miniprogram-accounts-v1";

const DEFAULT_ACCOUNTS = [
  { id: "cmb-credit-card", name: "招商信用卡", openingBalance: 0 },
  { id: "cmb-debit-card", name: "招商银行", openingBalance: 0 },
  { id: "bobj-bank-card", name: "北京银行", openingBalance: 0 },
  { id: "alipay", name: "支付宝", openingBalance: 0 },
  { id: "wechat", name: "微信", openingBalance: 0 },
  { id: "cash", name: "现金", openingBalance: 0 }
];

function loadAccounts() {
  const savedAccounts = readStorage(ACCOUNTS_STORAGE_KEY, null);
  const source = Array.isArray(savedAccounts) && savedAccounts.length > 0 ? savedAccounts : DEFAULT_ACCOUNTS;
  return source.map(normalizeAccount);
}

function saveAccounts(accounts) {
  writeStorage(ACCOUNTS_STORAGE_KEY, accounts.map(normalizeAccount));
}

function loadTransactions() {
  const savedTransactions = readStorage(TRANSACTIONS_STORAGE_KEY, []);
  if (!Array.isArray(savedTransactions)) {
    return [];
  }
  return savedTransactions.map(normalizeStoredTransaction).filter(Boolean);
}

function saveTransactions(transactions) {
  writeStorage(
    TRANSACTIONS_STORAGE_KEY,
    transactions.map(normalizeStoredTransaction).filter(Boolean)
  );
}

function getOpeningBalanceByAccountId(accounts) {
  const balances = {};
  for (const account of accounts) {
    balances[account.id] = roundMoney(Number(account.openingBalance));
  }
  return balances;
}

function normalizeAccount(account, index = 0) {
  const name = String(account && account.name ? account.name : "").trim() || "未命名账户";
  return {
    id: String(account && account.id ? account.id : createId(`account-${index}`)),
    name,
    openingBalance: roundMoney(Number(account && account.openingBalance)),
    createdAt: String(account && account.createdAt ? account.createdAt : new Date().toISOString())
  };
}

function normalizeStoredTransaction(transaction) {
  if (!transaction || typeof transaction !== "object") {
    return null;
  }
  return normalizeLedgerTransaction({
    ...transaction,
    id: String(transaction.id || createId("tx")),
    date: String(transaction.date || getToday()),
    description: String(transaction.description || "").trim() || "未填写说明",
    accountId: String(transaction.accountId || "")
  });
}

function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readStorage(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value === "" || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  wx.setStorageSync(key, value);
}

module.exports = {
  DEFAULT_ACCOUNTS,
  createId,
  getOpeningBalanceByAccountId,
  getToday,
  loadAccounts,
  loadTransactions,
  saveAccounts,
  saveTransactions
};
