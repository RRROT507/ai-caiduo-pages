const { calculateRunningBalances, roundMoney } = require("../../utils/ledger-core");
const {
  createId,
  getOpeningBalanceByAccountId,
  loadAccounts,
  loadTransactions,
  saveAccounts,
  saveTransactions
} = require("../../utils/storage");

Page({
  data: {
    accountRows: [],
    newAccountName: "",
    newOpeningBalance: ""
  },

  onShow() {
    this.loadAccountRows();
  },

  loadAccountRows() {
    const accounts = loadAccounts();
    const balances = calculateRunningBalances(loadTransactions(), {
      openingBalanceByAccountId: getOpeningBalanceByAccountId(accounts)
    });
    const accountRows = accounts.map((account) => ({
      ...account,
      draftName: account.name,
      draftOpeningBalance: String(account.openingBalance),
      currentBalanceText: formatMoney(balances.accountBalances.get(account.id) || account.openingBalance || 0)
    }));

    this.setData({ accountRows });
  },

  onNewAccountNameInput(event) {
    this.setData({ newAccountName: event.detail.value });
  },

  onNewOpeningBalanceInput(event) {
    this.setData({ newOpeningBalance: event.detail.value });
  },

  addAccount() {
    const name = String(this.data.newAccountName || "").trim();
    const openingBalance = roundMoney(Number(this.data.newOpeningBalance || 0));
    const accounts = loadAccounts();

    if (!name) {
      wx.showToast({ title: "请填写账户名称", icon: "none" });
      return;
    }
    if (accounts.some((account) => account.name === name)) {
      wx.showToast({ title: "账户名称已存在", icon: "none" });
      return;
    }

    saveAccounts([
      ...accounts,
      {
        id: createId("account"),
        name,
        openingBalance,
        createdAt: new Date().toISOString()
      }
    ]);
    this.setData({ newAccountName: "", newOpeningBalance: "" });
    wx.showToast({ title: "已添加", icon: "success" });
    this.loadAccountRows();
  },

  onAccountNameInput(event) {
    this.updateAccountRow(event.currentTarget.dataset.id, { draftName: event.detail.value });
  },

  onOpeningBalanceInput(event) {
    this.updateAccountRow(event.currentTarget.dataset.id, { draftOpeningBalance: event.detail.value });
  },

  updateAccountRow(id, patch) {
    this.setData({
      accountRows: this.data.accountRows.map((row) => (row.id === id ? { ...row, ...patch } : row))
    });
  },

  saveAccount(event) {
    const id = event.currentTarget.dataset.id;
    const row = this.data.accountRows.find((item) => item.id === id);
    const accounts = loadAccounts();
    const name = String(row && row.draftName ? row.draftName : "").trim();

    if (!row || !name) {
      wx.showToast({ title: "请填写账户名称", icon: "none" });
      return;
    }
    if (accounts.some((account) => account.id !== id && account.name === name)) {
      wx.showToast({ title: "账户名称已存在", icon: "none" });
      return;
    }

    saveAccounts(
      accounts.map((account) =>
        account.id === id
          ? {
              ...account,
              name,
              openingBalance: roundMoney(Number(row.draftOpeningBalance || 0))
            }
          : account
      )
    );
    wx.showToast({ title: "已保存", icon: "success" });
    this.loadAccountRows();
  },

  deleteAccount(event) {
    const id = event.currentTarget.dataset.id;
    const accounts = loadAccounts();
    const target = accounts.find((account) => account.id === id);

    if (!target) {
      return;
    }
    if (accounts.length <= 1) {
      wx.showToast({ title: "至少保留一个账户", icon: "none" });
      return;
    }

    wx.showModal({
      title: "删除账户",
      content: `确认删除「${target.name}」？相关流水会变为未指定账户。`,
      success: (result) => {
        if (!result.confirm) {
          return;
        }
        saveAccounts(accounts.filter((account) => account.id !== id));
        saveTransactions(
          loadTransactions().map((transaction) =>
            transaction.accountId === id ? { ...transaction, accountId: "" } : transaction
          )
        );
        wx.showToast({ title: "已删除", icon: "success" });
        this.loadAccountRows();
      }
    });
  }
});

function formatMoney(value) {
  const amount = roundMoney(Number(value));
  return `${amount < 0 ? "-" : ""}¥${Math.abs(amount).toFixed(2)}`;
}
