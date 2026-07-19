import { analyzeLedgerFile } from "./ledger-importer.mjs";
import {
  UNASSIGNED_ACCOUNT_ID,
  UNASSIGNED_ACCOUNT_NAME,
  calculateRunningBalances,
  compareLedgerTransactionsDescending,
  filterLedgerTransactions,
  inferCategory,
  roundMoney,
  summarizeSelection,
  toCsv,
} from "./ledger-core.mjs";

const STORAGE_KEY = "ai-caiduo-transactions-v1";
const ACCOUNTS_STORAGE_KEY = "ai-caiduo-accounts-v1";
const DEFAULT_ACCOUNTS = [
  { id: "cmb-credit-card", name: "招商信用卡", openingBalance: 0 },
  { id: "wechat", name: "微信", openingBalance: 0 },
  { id: "alipay", name: "支付宝", openingBalance: 0 },
  { id: "cash", name: "现金", openingBalance: 0 },
];
const CATEGORIES = ["餐饮", "交通", "购物", "居家", "医疗", "娱乐", "学习", "收入", "其他"];

const state = {
  transactions: loadTransactions(),
  accounts: loadAccounts(),
  pendingTransactions: [],
  pendingAccountCandidate: null,
  pendingAccountMode: "manual",
  pendingMatchedAccountId: "",
  selectedFile: null,
  startDate: getCurrentMonthStartDate(),
  endDate: getToday(),
  datePickerOpen: false,
  dateRangeDraftStart: "",
  visibleCalendarMonth: getCurrentMonth(),
  selectedAccountId: "all",
  categoryFilter: "all",
};

const elements = {
  dateRangeButton: document.querySelector("#dateRangeButton"),
  dateRangeLabel: document.querySelector("#dateRangeLabel"),
  dateRangePanel: document.querySelector("#dateRangePanel"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  calendarDays: document.querySelector("#calendarDays"),
  prevCalendarMonthButton: document.querySelector("#prevCalendarMonthButton"),
  nextCalendarMonthButton: document.querySelector("#nextCalendarMonthButton"),
  accountFilterInput: document.querySelector("#accountFilterInput"),
  incomeTotal: document.querySelector("#incomeTotal"),
  expenseTotal: document.querySelector("#expenseTotal"),
  balanceTotal: document.querySelector("#balanceTotal"),
  transactionCount: document.querySelector("#transactionCount"),
  categoryHint: document.querySelector("#categoryHint"),
  categoryBars: document.querySelector("#categoryBars"),
  entryForm: document.querySelector("#entryForm"),
  dateInput: document.querySelector("#dateInput"),
  directionInput: document.querySelector("#directionInput"),
  amountInput: document.querySelector("#amountInput"),
  accountInput: document.querySelector("#accountInput"),
  categoryInput: document.querySelector("#categoryInput"),
  descriptionInput: document.querySelector("#descriptionInput"),
  fileInput: document.querySelector("#fileInput"),
  fileName: document.querySelector("#fileName"),
  importAccountInput: document.querySelector("#importAccountInput"),
  detectedAccountPanel: document.querySelector("#detectedAccountPanel"),
  detectedAccountTitle: document.querySelector("#detectedAccountTitle"),
  detectedAccountDetail: document.querySelector("#detectedAccountDetail"),
  addDetectedAccountControl: document.querySelector("#addDetectedAccountControl"),
  addDetectedAccountInput: document.querySelector("#addDetectedAccountInput"),
  importButton: document.querySelector("#importButton"),
  importStatus: document.querySelector("#importStatus"),
  pendingPanel: document.querySelector("#pendingPanel"),
  pendingRows: document.querySelector("#pendingRows"),
  pendingCount: document.querySelector("#pendingCount"),
  confirmImportButton: document.querySelector("#confirmImportButton"),
  discardImportButton: document.querySelector("#discardImportButton"),
  categoryFilter: document.querySelector("#categoryFilter"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
  accountForm: document.querySelector("#accountForm"),
  accountNameInput: document.querySelector("#accountNameInput"),
  accountOpeningBalanceInput: document.querySelector("#accountOpeningBalanceInput"),
  accountStatus: document.querySelector("#accountStatus"),
  accountList: document.querySelector("#accountList"),
  emptyState: document.querySelector("#emptyState"),
  transactionRows: document.querySelector("#transactionRows"),
};

init();

function init() {
  elements.dateInput.value = getToday();
  renderCategoryOptions();
  renderAccountOptions();
  bindEvents();
  render();
  registerServiceWorker();
}

function bindEvents() {
  elements.dateRangeButton.addEventListener("click", () => {
    state.datePickerOpen = !state.datePickerOpen;
    state.dateRangeDraftStart = "";
    state.visibleCalendarMonth = state.startDate.slice(0, 7) || getCurrentMonth();
    renderDateRangeFilter();
  });

  elements.prevCalendarMonthButton.addEventListener("click", () => {
    state.visibleCalendarMonth = getPreviousMonth(state.visibleCalendarMonth);
    renderDateRangeFilter();
  });

  elements.nextCalendarMonthButton.addEventListener("click", () => {
    state.visibleCalendarMonth = getNextMonth(state.visibleCalendarMonth);
    renderDateRangeFilter();
  });

  elements.calendarDays.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date-value]");
    if (!button) {
      return;
    }

    selectDateRangeBoundary(button.dataset.dateValue);
  });

  elements.accountFilterInput.addEventListener("change", () => {
    state.selectedAccountId = elements.accountFilterInput.value || "all";
    render();
  });

  elements.directionInput.addEventListener("change", () => {
    const direction = elements.directionInput.value;
    if (direction === "income") {
      elements.categoryInput.value = "收入";
      return;
    }
    elements.categoryInput.value = inferCategory(elements.descriptionInput.value);
  });

  elements.descriptionInput.addEventListener("input", () => {
    if (elements.directionInput.value === "expense") {
      elements.categoryInput.value = inferCategory(elements.descriptionInput.value);
    }
  });

  elements.entryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addManualTransaction();
  });

  elements.fileInput.addEventListener("change", () => {
    state.selectedFile = elements.fileInput.files?.[0] || null;
    elements.fileName.textContent = state.selectedFile ? state.selectedFile.name : "尚未选择文件";
    state.pendingTransactions = [];
    clearPendingAccountCandidate();
    renderPendingImport();
    setImportStatus("");
  });

  elements.importButton.addEventListener("click", () => {
    importSelectedFile();
  });

  elements.confirmImportButton.addEventListener("click", () => {
    confirmPendingImport();
  });

  elements.discardImportButton.addEventListener("click", () => {
    discardPendingImport("已放弃本次识别结果");
  });

  elements.pendingRows.addEventListener("change", (event) => {
    const select = event.target.closest("[data-pending-category-id]");
    if (!select) {
      return;
    }

    updatePendingCategory(select.dataset.pendingCategoryId, select.value);
  });

  elements.pendingRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-pending-id]");
    if (!button) {
      return;
    }

    deletePendingTransaction(button.dataset.deletePendingId);
  });

  elements.categoryFilter.addEventListener("change", () => {
    state.categoryFilter = elements.categoryFilter.value;
    renderTransactions();
  });

  elements.exportButton.addEventListener("click", () => {
    exportTransactions();
  });

  elements.clearButton.addEventListener("click", () => {
    clearTransactions();
  });

  elements.transactionRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-id]");
    if (!button) {
      return;
    }

    deleteTransaction(button.dataset.deleteId);
  });

  elements.accountForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addAccount();
  });

  elements.accountList.addEventListener("change", (event) => {
    const nameInput = event.target.closest("[data-account-name-id]");
    if (nameInput) {
      renameAccount(nameInput.dataset.accountNameId, nameInput.value);
      return;
    }

    const openingInput = event.target.closest("[data-account-opening-id]");
    if (openingInput) {
      updateAccountOpeningBalance(openingInput.dataset.accountOpeningId, openingInput.value);
    }
  });

  elements.accountList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delete-account-id]");
    if (!button) {
      return;
    }

    deleteAccount(button.dataset.deleteAccountId);
  });
}

function addManualTransaction() {
  const amount = Number(elements.amountInput.value);
  const direction = elements.directionInput.value;
  const description = elements.descriptionInput.value.trim();
  const category = elements.categoryInput.value || inferCategory(description, direction);

  if (!amount || amount <= 0 || !description) {
    return;
  }

  const transaction = withId({
    date: elements.dateInput.value,
    description,
    amount: direction === "expense" ? -amount : amount,
    direction,
    category,
    accountId: normalizeAccountId(elements.accountInput.value),
    source: "manual",
  });

  state.transactions = [transaction, ...state.transactions];
  persist();
  elements.entryForm.reset();
  elements.dateInput.value = getToday();
  elements.directionInput.value = "expense";
  elements.accountInput.value = getDefaultAccountId();
  elements.categoryInput.value = inferCategory("");
  render();
}

async function importSelectedFile() {
  if (!state.selectedFile) {
    setImportStatus("请先选择账单文件");
    return;
  }

  elements.importButton.disabled = true;
  setImportStatus("正在识别账单文件...");

  try {
    const result = await analyzeLedgerFile(state.selectedFile, {
      endpoint: getAiImportEndpoint(),
      fallbackYear: Number(state.startDate.slice(0, 4)),
    });

    if (result.transactions.length === 0) {
      state.pendingTransactions = [];
      clearPendingAccountCandidate();
      renderPendingImport();
      setImportStatus(result.message || "没有识别到可导入交易");
      return;
    }

    state.pendingTransactions = result.transactions.map((transaction) => ({
      ...transaction,
      previewId: createId(),
    }));
    const accountResolution = resolveImportAccountCandidate(result.accountCandidate);
    state.pendingAccountCandidate = accountResolution.candidate;
    state.pendingAccountMode = accountResolution.mode;
    state.pendingMatchedAccountId = accountResolution.accountId;

    if (accountResolution.mode === "matched") {
      elements.importAccountInput.value = accountResolution.accountId;
    } else if (accountResolution.mode === "new") {
      elements.addDetectedAccountInput.checked = true;
    }
    renderPendingImport();
    setImportStatus(`${result.message}，请确认后入账`);
  } catch {
    state.pendingTransactions = [];
    clearPendingAccountCandidate();
    renderPendingImport();
    setImportStatus("识别失败，请换一个可复制文字的账单文件");
  } finally {
    elements.importButton.disabled = false;
  }
}

function confirmPendingImport() {
  if (state.pendingTransactions.length === 0) {
    setImportStatus("没有待确认交易");
    return;
  }

  let importAccountId = normalizeAccountId(elements.importAccountInput.value);

  if (
    state.pendingAccountMode === "new" &&
    state.pendingAccountCandidate &&
    elements.addDetectedAccountInput.checked
  ) {
    const createdAccount = createAccountFromCandidate(state.pendingAccountCandidate);
    importAccountId = createdAccount.id;
  }

  const baseSequence = getMaxTransactionSequence();
  const imported = state.pendingTransactions.map(({ previewId, ...transaction }, index) =>
    withId({ ...transaction, accountId: importAccountId }, baseSequence + index + 1),
  );
  state.transactions = [...imported, ...state.transactions];
  state.pendingTransactions = [];
  persist();
  clearPendingAccountCandidate();
  clearSelectedFile();
  setImportStatus(`已入账 ${imported.length} 笔`);
  render();
}

function discardPendingImport(message = "") {
  state.pendingTransactions = [];
  clearPendingAccountCandidate();
  renderPendingImport();
  setImportStatus(message);
}

function deletePendingTransaction(previewId) {
  state.pendingTransactions = state.pendingTransactions.filter(
    (transaction) => transaction.previewId !== previewId,
  );
  renderPendingImport();
}

function updatePendingCategory(previewId, category) {
  state.pendingTransactions = state.pendingTransactions.map((transaction) =>
    transaction.previewId === previewId ? { ...transaction, category } : transaction,
  );
}

function exportTransactions() {
  const transactions = getVisibleTransactions();
  if (transactions.length === 0) {
    return;
  }

  const csv = toCsv(transactions, { accountNameById: getAccountNameById() });
  const dateRangeSuffix = getDateRangeFileLabel();
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `AI财舵-${dateRangeSuffix}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function clearTransactions() {
  if (state.transactions.length === 0) {
    return;
  }

  if (!window.confirm("确认清空本机保存的全部交易？")) {
    return;
  }

  state.transactions = [];
  persist();
  render();
}

function deleteTransaction(id) {
  state.transactions = state.transactions.filter((transaction) => transaction.id !== id);
  persist();
  render();
}

function selectDateRangeBoundary(dateValue) {
  if (!state.dateRangeDraftStart) {
    state.dateRangeDraftStart = dateValue;
    renderDateRangeFilter();
    return;
  }

  const [startDate, endDate] = normalizeDateRange(state.dateRangeDraftStart, dateValue);
  state.startDate = startDate;
  state.endDate = endDate;
  state.dateRangeDraftStart = "";
  state.datePickerOpen = false;
  render();
}

function addAccount() {
  const name = elements.accountNameInput.value.trim();
  const openingBalance = parseMoneyInput(elements.accountOpeningBalanceInput.value);
  if (!name) {
    setAccountStatus("请输入账户名称");
    return;
  }
  if (state.accounts.some((account) => account.name === name)) {
    setAccountStatus("账户名称已存在");
    return;
  }

  state.accounts = [
    ...state.accounts,
    { id: createId(), name, openingBalance, createdAt: new Date().toISOString() },
  ];
  elements.accountNameInput.value = "";
  elements.accountOpeningBalanceInput.value = "";
  persistAccounts();
  setAccountStatus(`已添加 ${name}`);
  render();
}

function renameAccount(id, nextName) {
  const name = nextName.trim();
  if (!name) {
    setAccountStatus("账户名称不能为空");
    renderAccountList();
    return;
  }
  if (state.accounts.some((account) => account.id !== id && account.name === name)) {
    setAccountStatus("账户名称已存在");
    renderAccountList();
    return;
  }

  state.accounts = state.accounts.map((account) =>
    account.id === id ? { ...account, name } : account,
  );
  persistAccounts();
  setAccountStatus(`已更新 ${name}`);
  render();
}

function updateAccountOpeningBalance(id, nextValue) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) {
    return;
  }

  const openingBalance = parseMoneyInput(nextValue);
  state.accounts = state.accounts.map((item) =>
    item.id === id ? { ...item, openingBalance } : item,
  );
  persistAccounts();
  setAccountStatus(`已更新 ${account.name} 初始金额`);
  render();
}

function deleteAccount(id) {
  const account = state.accounts.find((item) => item.id === id);
  state.accounts = state.accounts.filter((item) => item.id !== id);
  if (state.selectedAccountId === id) {
    state.selectedAccountId = "all";
  }
  state.transactions = state.transactions.map((transaction) =>
    transaction.accountId === id ? { ...transaction, accountId: undefined } : transaction,
  );
  persist();
  persistAccounts();
  setAccountStatus(account ? `已删除 ${account.name}` : "");
  render();
}

function render() {
  renderDateRangeFilter();
  renderDashboardFilters();
  renderSummary();
  renderAccountOptions();
  renderAccountList();
  renderCategoryFilter();
  renderTransactions();
  renderPendingImport();
}

function renderDateRangeFilter() {
  const [startDate, endDate] = normalizeDateRange(state.startDate, state.endDate);
  state.startDate = startDate;
  state.endDate = endDate;
  elements.dateRangeLabel.textContent = getDateRangeLabel();
  elements.dateRangeButton.setAttribute("aria-expanded", String(state.datePickerOpen));
  elements.dateRangePanel.classList.toggle("is-hidden", !state.datePickerOpen);
  elements.calendarMonthLabel.textContent = `${state.visibleCalendarMonth.slice(0, 4)}年${Number(
    state.visibleCalendarMonth.slice(5, 7),
  )}月`;

  replaceChildrenCompat(
    elements.calendarDays,
    ...getCalendarDayItems(state.visibleCalendarMonth).map(createCalendarDayButton),
  );
}

function getCalendarDayItems(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const items = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    items.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    items.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return items;
}

function createCalendarDayButton(dateValue) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "calendar-day";
  if (!dateValue) {
    button.disabled = true;
    button.setAttribute("aria-hidden", "true");
    return button;
  }

  const hasDraftRangeStart = Boolean(state.dateRangeDraftStart);
  const inRange =
    !hasDraftRangeStart && dateValue >= state.startDate && dateValue <= state.endDate;
  button.dataset.dateValue = dateValue;
  button.textContent = String(Number(dateValue.slice(8, 10)));
  button.classList.toggle(
    "is-selected",
    hasDraftRangeStart
      ? dateValue === state.dateRangeDraftStart
      : dateValue === state.startDate || dateValue === state.endDate,
  );
  button.classList.toggle("is-in-range", inRange);
  return button;
}

function renderSummary() {
  const summary = summarizeSelection(state.transactions, {
    startDate: state.startDate,
    endDate: state.endDate,
    accountIds: getSelectedAccountIds(),
  });
  elements.incomeTotal.textContent = formatMoney(summary.income);
  elements.expenseTotal.textContent = formatMoney(summary.expense);
  elements.balanceTotal.textContent = formatMoney(summary.balance);
  elements.transactionCount.textContent = String(summary.count);

  replaceChildrenCompat(elements.categoryBars);
  elements.categoryHint.textContent =
    summary.categoryTotals.length === 0 ? "暂无支出" : `${summary.categoryTotals.length} 类支出`;

  const maxAmount = Math.max(...summary.categoryTotals.map((item) => item.amount), 1);
  for (const item of summary.categoryTotals.slice(0, 6)) {
    elements.categoryBars.append(createCategoryBar(item, maxAmount));
  }
}

function renderCategoryFilter() {
  const selected = state.categoryFilter;
  const categories = [
    "all",
    ...new Set(
      filterLedgerTransactions(state.transactions, {
        startDate: state.startDate,
        endDate: state.endDate,
        accountIds: getSelectedAccountIds(),
      }).map((transaction) => transaction.category),
    ),
  ];

  replaceChildrenCompat(
    elements.categoryFilter,
    ...categories.map((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category === "all" ? "全部分类" : category;
      return option;
    }),
  );

  elements.categoryFilter.value = categories.includes(selected) ? selected : "all";
  state.categoryFilter = elements.categoryFilter.value;
}

function renderTransactions() {
  const transactions = getVisibleTransactions();
  const { transactionBalances } = getRunningBalanceSnapshot();
  elements.emptyState.classList.toggle("is-hidden", transactions.length > 0);
  replaceChildrenCompat(
    elements.transactionRows,
    ...transactions.map((transaction) =>
      createTransactionRow(transaction, transactionBalances.get(transaction.id)),
    ),
  );
}

function renderPendingImport() {
  const hasPending = state.pendingTransactions.length > 0;
  elements.pendingPanel.classList.toggle("is-hidden", !hasPending);
  elements.pendingCount.textContent = `${state.pendingTransactions.length} 笔`;
  elements.confirmImportButton.disabled = !hasPending;
  replaceChildrenCompat(elements.pendingRows, ...state.pendingTransactions.map(createPendingRow));
  renderDetectedAccountPanel();
}

function renderDetectedAccountPanel() {
  const candidate = state.pendingAccountCandidate;
  const hasCandidate = Boolean(candidate && state.pendingTransactions.length > 0);
  elements.detectedAccountPanel.classList.toggle("is-hidden", !hasCandidate);
  if (!hasCandidate) {
    return;
  }

  if (state.pendingAccountMode === "matched") {
    const accountName = getAccountName(state.pendingMatchedAccountId);
    elements.detectedAccountTitle.textContent = `已匹配账户：${accountName}`;
    elements.detectedAccountDetail.textContent = candidate.accountNumberLast4
      ? `尾号 ${candidate.accountNumberLast4}`
      : "";
    elements.addDetectedAccountControl.classList.add("is-hidden");
    return;
  }

  elements.detectedAccountTitle.textContent = `识别到新账户：${candidate.accountName}`;
  elements.detectedAccountDetail.textContent = `初始金额 ${formatMoney(
    candidate.openingBalanceEstimate || 0,
  )}`;
  elements.addDetectedAccountControl.classList.remove("is-hidden");
}

function renderCategoryOptions() {
  replaceChildrenCompat(
    elements.categoryInput,
    ...CATEGORIES.map((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      return option;
    }),
  );
  elements.categoryInput.value = "其他";
}

function renderAccountOptions() {
  renderAccountSelect(elements.accountInput, elements.accountInput.value);
  renderAccountSelect(elements.importAccountInput, elements.importAccountInput.value);
}

function renderAccountSelect(select, selectedValue) {
  const defaultValue = getDefaultAccountId();
  const accountOptions = [
    createOption(UNASSIGNED_ACCOUNT_ID, UNASSIGNED_ACCOUNT_NAME),
    ...state.accounts.map((account) => createOption(account.id, account.name)),
  ];
  const values = new Set(accountOptions.map((option) => option.value));

  replaceChildrenCompat(select, ...accountOptions);
  select.value = values.has(selectedValue) ? selectedValue : defaultValue;
}

function renderAccountList() {
  const { accountBalances } = getRunningBalanceSnapshot();
  replaceChildrenCompat(
    elements.accountList,
    ...state.accounts.map((account) => {
      const row = document.createElement("div");
      row.className = "account-row";
      const openingBalance = getAccountOpeningBalance(account);
      const currentBalance = accountBalances.has(account.id)
        ? accountBalances.get(account.id)
        : openingBalance;
      row.innerHTML = `
        <label class="account-row-field account-name-field">
          <span>账户名称</span>
          <input data-account-name-id="${escapeHtml(account.id)}" value="${escapeHtml(
            account.name,
          )}" aria-label="账户名称" />
        </label>
        <label class="account-row-field">
          <span>初始金额</span>
          <input
            data-account-opening-id="${escapeHtml(account.id)}"
            value="${escapeHtml(formatMoneyInput(openingBalance))}"
            type="number"
            step="0.01"
            inputmode="decimal"
            aria-label="初始金额"
          />
        </label>
        <span class="account-balance">
          <span>当前余额</span>
          <strong>${escapeHtml(formatMoney(currentBalance))}</strong>
        </span>
        <button class="delete-button" type="button" data-delete-account-id="${escapeHtml(
          account.id,
        )}">删除</button>
      `;
      return row;
    }),
  );
}

function renderDashboardFilters() {
  const accountOptions = [
    createOption("all", "全部账户"),
    createOption(UNASSIGNED_ACCOUNT_ID, UNASSIGNED_ACCOUNT_NAME),
    ...state.accounts.map((account) => createOption(account.id, account.name)),
  ];
  const accountValues = new Set(accountOptions.map((option) => option.value));
  if (!accountValues.has(state.selectedAccountId)) {
    state.selectedAccountId = "all";
  }

  replaceChildrenCompat(elements.accountFilterInput, ...accountOptions);
  elements.accountFilterInput.value = state.selectedAccountId;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function getDefaultAccountId() {
  return state.accounts.some((account) => account.id === "cmb-credit-card")
    ? "cmb-credit-card"
    : state.accounts[0]?.id || UNASSIGNED_ACCOUNT_ID;
}

function getAccountName(accountId) {
  return (
    state.accounts.find((account) => account.id === accountId)?.name || UNASSIGNED_ACCOUNT_NAME
  );
}

function getAccountNameById() {
  return Object.fromEntries(state.accounts.map((account) => [account.id, account.name]));
}

function getAccountOpeningBalanceById() {
  return Object.fromEntries(
    state.accounts.map((account) => [account.id, getAccountOpeningBalance(account)]),
  );
}

function getAccountOpeningBalance(account) {
  return parseMoneyInput(account?.openingBalance);
}

function getRunningBalanceSnapshot() {
  return calculateRunningBalances(state.transactions, {
    openingBalanceByAccountId: getAccountOpeningBalanceById(),
  });
}

function getSelectedAccountIds() {
  return state.selectedAccountId === "all" ? [] : [state.selectedAccountId];
}

function getDateRangeFileLabel() {
  return state.startDate === state.endDate ? state.startDate : `${state.startDate}_${state.endDate}`;
}

function getDateRangeLabel() {
  return state.startDate === state.endDate
    ? state.startDate
    : `${state.startDate} 至 ${state.endDate}`;
}

function normalizeDateRange(startDate, endDate) {
  const today = getToday();
  const safeStart = isDateKey(startDate) ? startDate : getCurrentMonthStartDate();
  const safeEnd = isDateKey(endDate) ? endDate : today;
  return safeStart <= safeEnd ? [safeStart, safeEnd] : [safeEnd, safeStart];
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

function getCurrentMonthStartDate() {
  return `${getCurrentMonth()}-01`;
}

function getPreviousMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return `${previousYear}-${String(previousMonth).padStart(2, "0")}`;
}

function getNextMonth(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

function createCategoryBar(item, maxAmount) {
  const row = document.createElement("div");
  row.className = "category-bar";

  const label = document.createElement("strong");
  label.textContent = item.category;

  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  fill.className = "bar-fill";
  fill.style.width = `${Math.max(8, (item.amount / maxAmount) * 100)}%`;
  track.append(fill);

  const amount = document.createElement("span");
  amount.className = "bar-amount";
  amount.textContent = formatMoney(item.amount);

  row.append(label, track, amount);
  return row;
}

function createTransactionRow(transaction, accountBalance = 0) {
  const row = document.createElement("tr");
  const isIncome = transaction.direction === "income";
  row.innerHTML = `
    <td data-label="日期">${escapeHtml(transaction.date)}</td>
    <td data-label="账户">${escapeHtml(getAccountName(transaction.accountId))}</td>
    <td data-label="说明">${escapeHtml(transaction.description)}</td>
    <td data-label="分类"><span class="tag">${escapeHtml(transaction.category)}</span></td>
    <td data-label="类型">${isIncome ? "收入" : "支出"}</td>
    <td data-label="金额" class="amount-cell ${isIncome ? "income-text" : "expense-text"}">${escapeHtml(
      formatSignedMoney(transaction.amount),
    )}</td>
    <td data-label="账户余额" class="amount-cell">${escapeHtml(formatMoney(accountBalance || 0))}</td>
    <td data-label="操作" class="action-cell">
      <button class="delete-button" type="button" data-delete-id="${escapeHtml(
        transaction.id,
      )}">删除</button>
    </td>
  `;
  return row;
}

function createPendingRow(transaction) {
  const row = document.createElement("tr");
  const isIncome = transaction.direction === "income";
  row.innerHTML = `
    <td data-label="日期">${escapeHtml(transaction.date)}</td>
    <td data-label="说明">${escapeHtml(transaction.description)}</td>
    <td data-label="分类">
      <select class="compact-select" data-pending-category-id="${escapeHtml(
        transaction.previewId,
      )}" aria-label="调整分类">
        ${CATEGORIES.map(
          (category) =>
            `<option value="${escapeHtml(category)}" ${
              category === transaction.category ? "selected" : ""
            }>${escapeHtml(category)}</option>`,
        ).join("")}
      </select>
    </td>
    <td data-label="金额" class="amount-cell ${isIncome ? "income-text" : "expense-text"}">${escapeHtml(
      formatSignedMoney(transaction.amount),
    )}</td>
    <td data-label="操作" class="action-cell">
      <button class="delete-button" type="button" data-delete-pending-id="${escapeHtml(
        transaction.previewId,
      )}">删除</button>
    </td>
  `;
  return row;
}

function getVisibleTransactions() {
  return filterLedgerTransactions(state.transactions, {
    startDate: state.startDate,
    endDate: state.endDate,
    accountIds: getSelectedAccountIds(),
  })
    .filter(
      (transaction) =>
        state.categoryFilter === "all" || transaction.category === state.categoryFilter,
    )
    .sort(compareLedgerTransactionsDescending);
}

function withId(transaction, sequence = getNextTransactionSequence()) {
  return {
    id: createId(),
    createdAt: new Date().toISOString(),
    sequence,
    ...transaction,
  };
}

function getNextTransactionSequence() {
  return getMaxTransactionSequence() + 1;
}

function getMaxTransactionSequence() {
  return state.transactions.reduce((max, transaction) => {
    const sequence = Number(transaction.sequence);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
}

function replaceChildrenCompat(parent, ...children) {
  if (typeof parent.replaceChildren === "function") {
    parent.replaceChildren(...children);
    return;
  }

  while (parent.firstChild) {
    parent.removeChild(parent.firstChild);
  }

  for (const child of children) {
    parent.appendChild(child);
  }
}

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? ensureTransactionSequences(parsed.filter(isValidTransaction)) : [];
  } catch {
    return [];
  }
}

function ensureTransactionSequences(transactions) {
  let maxSequence = transactions.reduce((max, transaction) => {
    const sequence = Number(transaction.sequence);
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);

  return transactions.map((transaction) => {
    if (Number.isFinite(Number(transaction.sequence))) {
      return transaction;
    }

    maxSequence += 1;
    return { ...transaction, sequence: maxSequence };
  });
}

function loadAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!raw) {
      return createDefaultAccounts();
    }
    const parsed = JSON.parse(raw);
    const accounts = Array.isArray(parsed) ? parsed.map(normalizeAccount).filter(Boolean) : [];
    return accounts.length > 0 ? accounts : [];
  } catch {
    return createDefaultAccounts();
  }
}

function createDefaultAccounts() {
  return DEFAULT_ACCOUNTS.map((account) => ({
    ...account,
    openingBalance: getAccountOpeningBalance(account),
    createdAt: new Date().toISOString(),
  }));
}

function persistAccounts() {
  localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(state.accounts));
}

function isValidAccount(account) {
  return Boolean(account && account.id && String(account.name || "").trim());
}

function normalizeAccount(account) {
  if (!isValidAccount(account)) {
    return null;
  }

  return {
    ...account,
    name: String(account.name).trim(),
    openingBalance: parseMoneyInput(account.openingBalance),
    institution: String(account.institution || "").trim(),
    accountNumberLast4: String(account.accountNumberLast4 || "").trim(),
    accountFingerprint: String(account.accountFingerprint || "").trim(),
  };
}

function resolveImportAccountCandidate(candidate) {
  if (!candidate) {
    return { mode: "manual", accountId: "", candidate: null };
  }

  const fingerprint = String(candidate.accountFingerprint || "").trim();
  const byFingerprint = fingerprint
    ? state.accounts.find((account) => account.accountFingerprint === fingerprint)
    : null;
  if (byFingerprint) {
    return { mode: "matched", accountId: byFingerprint.id, candidate };
  }

  const accountName = String(candidate.accountName || "").trim();
  const byName = accountName
    ? state.accounts.find((account) => account.name === accountName)
    : null;
  if (byName) {
    return { mode: "matched", accountId: byName.id, candidate };
  }

  return { mode: "new", accountId: "", candidate };
}

function createAccountFromCandidate(candidate) {
  const account = normalizeAccount({
    id: createId(),
    name: getAvailableAccountName(candidate.accountName, candidate.accountNumberLast4),
    openingBalance: candidate.openingBalanceEstimate,
    institution: candidate.institution,
    accountNumberLast4: candidate.accountNumberLast4,
    accountFingerprint: candidate.accountFingerprint,
    createdAt: new Date().toISOString(),
  });

  state.accounts = [...state.accounts, account].filter(Boolean);
  persistAccounts();
  return account;
}

function getAvailableAccountName(baseName, suffix) {
  const fallbackName = suffix ? `招商银行 尾号${suffix}` : "招商银行账户";
  const name = String(baseName || fallbackName).trim();
  if (!state.accounts.some((account) => account.name === name)) {
    return name;
  }

  const suffixedName = suffix ? `招商银行 尾号${suffix}` : `${name} 2`;
  if (!state.accounts.some((account) => account.name === suffixedName)) {
    return suffixedName;
  }

  let index = 2;
  while (state.accounts.some((account) => account.name === `${suffixedName} ${index}`)) {
    index += 1;
  }
  return `${suffixedName} ${index}`;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
}

function isValidTransaction(transaction) {
  return Boolean(
    transaction &&
      transaction.id &&
      transaction.date &&
      transaction.description &&
      Number.isFinite(Number(transaction.amount)),
  );
}

function clearSelectedFile() {
  state.selectedFile = null;
  elements.fileInput.value = "";
  elements.fileName.textContent = "尚未选择文件";
  clearPendingAccountCandidate();
}

function clearPendingAccountCandidate() {
  state.pendingAccountCandidate = null;
  state.pendingAccountMode = "manual";
  state.pendingMatchedAccountId = "";
}

function setImportStatus(message) {
  elements.importStatus.textContent = message;
}

function setAccountStatus(message) {
  elements.accountStatus.textContent = message;
}

function normalizeAccountId(accountId) {
  return accountId && accountId !== UNASSIGNED_ACCOUNT_ID ? accountId : undefined;
}

function parseMoneyInput(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? roundMoney(amount) : 0;
}

function getAiImportEndpoint() {
  const globalEndpoint = globalThis.AI_CAIDUO_IMPORT_ENDPOINT;
  if (typeof globalEndpoint === "string" && globalEndpoint.trim()) {
    return globalEndpoint.trim();
  }

  return document.querySelector('meta[name="ai-import-endpoint"]')?.content?.trim() || "";
}

function formatMoney(amount) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(amount);
}

function formatSignedMoney(amount) {
  const value = formatMoney(Math.abs(amount));
  return Number(amount) >= 0 ? `+${value}` : `-${value}`;
}

function formatMoneyInput(amount) {
  const value = parseMoneyInput(amount);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function getCurrentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function getToday() {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    return;
  }

  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}
