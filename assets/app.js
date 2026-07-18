import {
  inferCategory,
  parseLedgerText,
  summarizeMonth,
  toCsv,
} from "./ledger-core.mjs";

const STORAGE_KEY = "ai-caiduo-transactions-v1";
const CATEGORIES = ["餐饮", "交通", "购物", "居家", "医疗", "娱乐", "学习", "收入", "其他"];
const SAMPLE_TEXT = `2026-07-02 星巴克咖啡 -32.50
2026/07/03 工资入账 12000.00 收入
07-04 滴滴出行 支出 48.20
2026-07-05 超市购物 -168.90`;

const state = {
  transactions: loadTransactions(),
  month: getCurrentMonth(),
  categoryFilter: "all",
};

const elements = {
  monthInput: document.querySelector("#monthInput"),
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
  categoryInput: document.querySelector("#categoryInput"),
  descriptionInput: document.querySelector("#descriptionInput"),
  pasteInput: document.querySelector("#pasteInput"),
  sampleButton: document.querySelector("#sampleButton"),
  importButton: document.querySelector("#importButton"),
  importStatus: document.querySelector("#importStatus"),
  categoryFilter: document.querySelector("#categoryFilter"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
  emptyState: document.querySelector("#emptyState"),
  transactionRows: document.querySelector("#transactionRows"),
};

init();

function init() {
  elements.monthInput.value = state.month;
  elements.dateInput.value = getToday();
  renderCategoryOptions();
  bindEvents();
  render();
  registerServiceWorker();
}

function bindEvents() {
  elements.monthInput.addEventListener("change", () => {
    state.month = elements.monthInput.value || getCurrentMonth();
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

  elements.sampleButton.addEventListener("click", () => {
    elements.pasteInput.value = SAMPLE_TEXT;
    elements.pasteInput.focus();
  });

  elements.importButton.addEventListener("click", () => {
    importPastedTransactions();
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
    source: "manual",
  });

  state.transactions = [transaction, ...state.transactions];
  persist();
  elements.entryForm.reset();
  elements.dateInput.value = getToday();
  elements.directionInput.value = "expense";
  elements.categoryInput.value = inferCategory("");
  render();
}

function importPastedTransactions() {
  const parsed = parseLedgerText(elements.pasteInput.value, {
    fallbackYear: Number(state.month.slice(0, 4)),
  });

  if (parsed.length === 0) {
    setImportStatus("没有识别到可导入交易");
    return;
  }

  const imported = parsed.map(withId);
  state.transactions = [...imported, ...state.transactions];
  persist();
  elements.pasteInput.value = "";
  setImportStatus(`已导入 ${imported.length} 笔`);
  render();
}

function exportTransactions() {
  const transactions = getVisibleTransactions();
  if (transactions.length === 0) {
    return;
  }

  const csv = toCsv(transactions);
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `AI财舵-${state.month}.csv`;
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

function render() {
  renderSummary();
  renderCategoryFilter();
  renderTransactions();
}

function renderSummary() {
  const summary = summarizeMonth(state.transactions, state.month);
  elements.incomeTotal.textContent = formatMoney(summary.income);
  elements.expenseTotal.textContent = formatMoney(summary.expense);
  elements.balanceTotal.textContent = formatMoney(summary.balance);
  elements.transactionCount.textContent = String(summary.count);

  elements.categoryBars.replaceChildren();
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
      state.transactions
        .filter((transaction) => transaction.date.startsWith(`${state.month}-`))
        .map((transaction) => transaction.category),
    ),
  ];

  elements.categoryFilter.replaceChildren(
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
  elements.emptyState.classList.toggle("is-hidden", transactions.length > 0);
  elements.transactionRows.replaceChildren(...transactions.map(createTransactionRow));
}

function renderCategoryOptions() {
  elements.categoryInput.replaceChildren(
    ...CATEGORIES.map((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      return option;
    }),
  );
  elements.categoryInput.value = "其他";
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

function createTransactionRow(transaction) {
  const row = document.createElement("tr");
  const isIncome = transaction.direction === "income";
  row.innerHTML = `
    <td data-label="日期">${escapeHtml(transaction.date)}</td>
    <td data-label="说明">${escapeHtml(transaction.description)}</td>
    <td data-label="分类"><span class="tag">${escapeHtml(transaction.category)}</span></td>
    <td data-label="类型">${isIncome ? "收入" : "支出"}</td>
    <td data-label="金额" class="amount-cell ${isIncome ? "income-text" : "expense-text"}">${escapeHtml(
      formatSignedMoney(transaction.amount),
    )}</td>
    <td data-label="操作" class="action-cell">
      <button class="delete-button" type="button" data-delete-id="${escapeHtml(
        transaction.id,
      )}">删除</button>
    </td>
  `;
  return row;
}

function getVisibleTransactions() {
  return state.transactions
    .filter((transaction) => transaction.date.startsWith(`${state.month}-`))
    .filter(
      (transaction) =>
        state.categoryFilter === "all" || transaction.category === state.categoryFilter,
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function withId(transaction) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    createdAt: new Date().toISOString(),
    ...transaction,
  };
}

function loadTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isValidTransaction) : [];
  } catch {
    return [];
  }
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

function setImportStatus(message) {
  elements.importStatus.textContent = message;
  window.clearTimeout(setImportStatus.timeoutId);
  setImportStatus.timeoutId = window.setTimeout(() => {
    elements.importStatus.textContent = "";
  }, 3200);
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

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
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
