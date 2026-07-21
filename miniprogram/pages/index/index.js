const {
  calculateRunningBalances,
  compareLedgerTransactionsDescending,
  filterLedgerTransactions,
  getCategoriesForType,
  getTransactionType,
  getTransactionTypes,
  getTypeLabel,
  normalizeTransactionType,
  recommendCategory,
  roundMoney,
  summarizeSelection
} = require("../../utils/ledger-core");
const {
  createId,
  getOpeningBalanceByAccountId,
  getToday,
  loadAccounts,
  loadTransactions,
  saveTransactions
} = require("../../utils/storage");

Page({
  data: {
    accounts: [],
    accountFilterOptions: [],
    accountFilterIndex: 0,
    accountIndex: 0,
    toAccountIndex: 0,
    startDate: getMonthStartDate(),
    endDate: getToday(),
    summary: createSummary(),
    transactionTypes: getTransactionTypes().filter((item) => item.value !== "refunded"),
    typeIndex: 0,
    categoryOptions: getCategoriesForType("expense"),
    categoryIndex: 0,
    isTransfer: false,
    form: {
      date: getToday(),
      amount: "",
      description: ""
    },
    recentTransactions: []
  },

  onShow() {
    this.loadLedger();
  },

  loadLedger() {
    const accounts = loadAccounts();
    const transactions = loadTransactions();
    const accountFilterOptions = [{ id: "all", name: "全部账户" }, ...accounts];
    const accountIndex = Math.min(this.data.accountIndex, accounts.length - 1);
    const toAccountIndex = normalizeToAccountIndex(accountIndex, this.data.toAccountIndex, accounts.length);

    this.setData({
      accounts,
      accountFilterOptions,
      accountIndex,
      toAccountIndex
    });
    this.renderLedger(transactions, accounts);
  },

  renderLedger(transactions, accounts) {
    const accountFilter = this.data.accountFilterOptions[this.data.accountFilterIndex] || { id: "all" };
    const summary = summarizeSelection(transactions, {
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      accountId: accountFilter.id
    });
    const balances = calculateRunningBalances(transactions, {
      openingBalanceByAccountId: getOpeningBalanceByAccountId(accounts)
    });
    const accountMap = new Map(accounts.map((account) => [account.id, account.name]));
    const recentTransactions = filterLedgerTransactions(transactions, {
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      accountId: accountFilter.id
    })
      .sort(compareLedgerTransactionsDescending)
      .slice(0, 5)
      .map((transaction) => decorateTransaction(transaction, accountMap, balances.transactionBalances));

    this.setData({
      summary: createSummary(summary),
      recentTransactions
    });
  },

  onStartDateChange(event) {
    const startDate = event.detail.value;
    const endDate = this.data.endDate < startDate ? startDate : this.data.endDate;
    this.setData({ startDate, endDate });
    this.renderLedger(loadTransactions(), loadAccounts());
  },

  onEndDateChange(event) {
    const endDate = event.detail.value;
    const startDate = this.data.startDate > endDate ? endDate : this.data.startDate;
    this.setData({ startDate, endDate });
    this.renderLedger(loadTransactions(), loadAccounts());
  },

  onAccountFilterChange(event) {
    this.setData({ accountFilterIndex: Number(event.detail.value) || 0 });
    this.renderLedger(loadTransactions(), loadAccounts());
  },

  onEntryDateChange(event) {
    this.setData({ "form.date": event.detail.value });
  },

  onTypeChange(event) {
    const typeIndex = Number(event.detail.value) || 0;
    const type = this.data.transactionTypes[typeIndex].value;
    const categoryOptions = getCategoriesForType(type);
    const category = recommendCategory(this.data.form.description, type).category;
    const categoryIndex = Math.max(0, categoryOptions.indexOf(category));

    this.setData({
      typeIndex,
      categoryOptions,
      categoryIndex,
      isTransfer: type === "transfer"
    });
  },

  onEntryAccountChange(event) {
    const accountIndex = Number(event.detail.value) || 0;
    this.setData({
      accountIndex,
      toAccountIndex: normalizeToAccountIndex(accountIndex, this.data.toAccountIndex, this.data.accounts.length)
    });
  },

  onTransferToAccountChange(event) {
    this.setData({ toAccountIndex: Number(event.detail.value) || 0 });
  },

  onCategoryChange(event) {
    this.setData({ categoryIndex: Number(event.detail.value) || 0 });
  },

  onAmountInput(event) {
    this.setData({ "form.amount": event.detail.value });
  },

  onDescriptionInput(event) {
    const description = event.detail.value;
    const type = this.data.transactionTypes[this.data.typeIndex].value;
    const categoryOptions = this.data.categoryOptions;
    const recommendedCategory = recommendCategory(description, type).category;
    const categoryIndex = Math.max(0, categoryOptions.indexOf(recommendedCategory));

    this.setData({
      "form.description": description,
      categoryIndex
    });
  },

  submitTransaction() {
    const accounts = loadAccounts();
    const transactions = loadTransactions();
    const type = normalizeTransactionType(this.data.transactionTypes[this.data.typeIndex].value);
    const amount = roundMoney(Number(this.data.form.amount));
    const fromAccount = accounts[this.data.accountIndex];
    const toAccount = accounts[this.data.toAccountIndex];
    const description = String(this.data.form.description || "").trim();

    if (!fromAccount || !Number.isFinite(amount) || amount <= 0 || !description) {
      wx.showToast({ title: "请补全金额和说明", icon: "none" });
      return;
    }
    if (type === "transfer" && (!toAccount || toAccount.id === fromAccount.id)) {
      wx.showToast({ title: "请选择不同的转入账户", icon: "none" });
      return;
    }

    const createdAt = new Date().toISOString();
    const date = this.data.form.date || getToday();
    const category = type === "transfer" ? "转账" : this.data.categoryOptions[this.data.categoryIndex];
    const nextTransactions =
      type === "transfer"
        ? [
            ...transactions,
            {
              id: createId("tx"),
              date,
              description,
              amount: -amount,
              direction: "expense",
              type: "transfer",
              category,
              accountId: fromAccount.id,
              createdAt
            },
            {
              id: createId("tx"),
              date,
              description,
              amount,
              direction: "income",
              type: "transfer",
              category,
              accountId: toAccount.id,
              createdAt
            }
          ]
        : [
            ...transactions,
            {
              id: createId("tx"),
              date,
              description,
              amount: type === "income" ? amount : -amount,
              direction: type,
              category,
              accountId: fromAccount.id,
              createdAt
            }
          ];

    saveTransactions(nextTransactions);
    this.setData({
      "form.amount": "",
      "form.description": ""
    });
    wx.showToast({ title: "已添加", icon: "success" });
    this.loadLedger();
  },

  navigateToPage(event) {
    wx.navigateTo({ url: event.currentTarget.dataset.url });
  }
});

function decorateTransaction(transaction, accountMap, transactionBalances) {
  const type = getTransactionType(transaction);
  const amount = roundMoney(Number(transaction.amount));
  return {
    ...transaction,
    accountName: accountMap.get(transaction.accountId) || "未指定账户",
    amountText: formatMoney(amount),
    balanceText: formatMoney(transactionBalances.get(transaction.id) || 0),
    typeLabel: getTypeLabel(type),
    typeClass: `pill-${type}`,
    amountClass: type === "transfer" || type === "refunded" ? "neutral-text" : amount > 0 ? "income-text" : "expense-text"
  };
}

function createSummary(summary = {}) {
  return {
    incomeText: formatMoney(summary.income || 0),
    expenseText: formatMoney(summary.expense || 0),
    balanceText: formatMoney(summary.balance || 0),
    count: summary.count || 0
  };
}

function formatMoney(value) {
  const amount = roundMoney(Number(value));
  return `${amount < 0 ? "-" : ""}¥${Math.abs(amount).toFixed(2)}`;
}

function getMonthStartDate() {
  return `${getToday().slice(0, 7)}-01`;
}

function normalizeToAccountIndex(accountIndex, toAccountIndex, accountCount) {
  if (accountCount <= 1) {
    return 0;
  }
  if (toAccountIndex !== accountIndex && toAccountIndex < accountCount) {
    return toAccountIndex;
  }
  return accountIndex === 0 ? 1 : 0;
}
