const {
  calculateRunningBalances,
  compareLedgerTransactionsDescending,
  getTransactionType,
  getTypeLabel,
  roundMoney
} = require("../../utils/ledger-core");
const {
  getOpeningBalanceByAccountId,
  loadAccounts,
  loadTransactions,
  saveTransactions
} = require("../../utils/storage");

Page({
  data: {
    rows: [],
    selectedIds: [],
    selectedCount: 0
  },

  onShow() {
    this.loadRecords();
  },

  loadRecords() {
    const accounts = loadAccounts();
    const transactions = loadTransactions();
    const balances = calculateRunningBalances(transactions, {
      openingBalanceByAccountId: getOpeningBalanceByAccountId(accounts)
    });
    const accountMap = new Map(accounts.map((account) => [account.id, account.name]));
    const selectedIdSet = new Set(this.data.selectedIds);
    const rows = transactions
      .sort(compareLedgerTransactionsDescending)
      .map((transaction) => decorateRecord(transaction, accountMap, balances.transactionBalances, selectedIdSet));

    this.setData({ rows, selectedCount: selectedIdSet.size });
  },

  onSelectionChange(event) {
    const selectedIds = event.detail.value || [];
    this.setData({
      selectedIds,
      selectedCount: selectedIds.length,
      rows: this.data.rows.map((row) => ({ ...row, checked: selectedIds.includes(row.id) }))
    });
  },

  deleteSelectedTransactions() {
    const selectedIds = new Set(this.data.selectedIds);
    if (selectedIds.size === 0) {
      return;
    }

    wx.showModal({
      title: "删除流水",
      content: `确认删除已选择的 ${selectedIds.size} 条流水？`,
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        const transactions = loadTransactions().filter((transaction) => !selectedIds.has(transaction.id));
        saveTransactions(transactions);
        this.setData({ selectedIds: [], selectedCount: 0 });
        wx.showToast({ title: "已删除", icon: "success" });
        this.loadRecords();
      }
    });
  }
});

function decorateRecord(transaction, accountMap, transactionBalances, selectedIdSet) {
  const type = getTransactionType(transaction);
  const amount = roundMoney(Number(transaction.amount));
  return {
    ...transaction,
    checked: selectedIdSet.has(transaction.id),
    accountName: accountMap.get(transaction.accountId) || "未指定账户",
    amountText: formatMoney(amount),
    balanceText: formatMoney(transactionBalances.get(transaction.id) || 0),
    typeLabel: getTypeLabel(type),
    typeClass: `pill-${type}`,
    amountClass: type === "transfer" || type === "refunded" ? "neutral-text" : amount > 0 ? "income-text" : "expense-text"
  };
}

function formatMoney(value) {
  const amount = roundMoney(Number(value));
  return `${amount < 0 ? "-" : ""}¥${Math.abs(amount).toFixed(2)}`;
}
