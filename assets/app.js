import { analyzeLedgerFile } from "./ledger-importer.mjs";
import { inferCategory, summarizeMonth, toCsv } from "./ledger-core.mjs";

const STORAGE_KEY = "ai-caiduo-transactions-v1";
const CATEGORIES = ["餐饮", "交通", "购物", "居家", "医疗", "娱乐", "学习", "收入", "其他"];

const state = {
  transactions: loadTransactions(),
  pendingTransactions: [],
  selectedFile: null,
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
  fileInput: document.querySelector("#fileInput"),
  fileName: document.querySelector("#fileName"),
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

  elements.fileInput.addEventListener("change", () => {
    state.selectedFile = elements.fileInput.files?.[0] || null;
    elements.fileName.textContent = state.selectedFile ? state.selectedFile.name : "尚未选择文件";
    state.pendingTransactions = [];
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
      fallbackYear: Number(state.month.slice(0, 4)),
    });

    if (result.transactions.length === 0) {
      state.pendingTransactions = [];
      renderPendingImport();
      setImportStatus(result.message || "没有识别到可导入交易");
      return;
    }

    state.pendingTransactions = result.transactions.map((transaction) => ({
      ...transaction,
      previewId: createId(),
    }));
    renderPendingImport();
    setImportStatus(`${result.message}，请确认后入账`);
  } catch {
    state.pendingTransactions = [];
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

  const imported = state.pendingTransactions.map(({ previewId, ...transaction }) =>
    withId(transaction),
  );
  state.transactions = [...imported, ...state.transactions];
  state.pendingTransactions = [];
  persist();
  clearSelectedFile();
  setImportStatus(`已入账 ${imported.length} 笔`);
  render();
}

function discardPendingImport(message = "") {
  state.pendingTransactions = [];
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
  renderPendingImport();
}

function renderSummary() {
  const summary = summarizeMonth(state.transactions, state.month);
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
      state.transactions
        .filter((transaction) => transaction.date.startsWith(`${state.month}-`))
        .map((transaction) => transaction.category),
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
  elements.emptyState.classList.toggle("is-hidden", transactions.length > 0);
  replaceChildrenCompat(elements.transactionRows, ...transactions.map(createTransactionRow));
}

function renderPendingImport() {
  const hasPending = state.pendingTransactions.length > 0;
  elements.pendingPanel.classList.toggle("is-hidden", !hasPending);
  elements.pendingCount.textContent = `${state.pendingTransactions.length} 笔`;
  elements.confirmImportButton.disabled = !hasPending;
  replaceChildrenCompat(elements.pendingRows, ...state.pendingTransactions.map(createPendingRow));
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
    id: createId(),
    createdAt: new Date().toISOString(),
    ...transaction,
  };
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

function clearSelectedFile() {
  state.selectedFile = null;
  elements.fileInput.value = "";
  elements.fileName.textContent = "尚未选择文件";
}

function setImportStatus(message) {
  elements.importStatus.textContent = message;
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
