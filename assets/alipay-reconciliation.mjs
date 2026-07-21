import {
  getTransactionType,
  isFallbackCategory,
  normalizeTransactionCategory,
  recommendCategory,
  roundMoney,
} from "./ledger-core.mjs";

export function buildAlipayTransactionUpdates({
  reconciliationItems = [],
  transactions = [],
  accounts = [],
  categoryHistory,
  createPreviewId = () => "",
} = {}) {
  const updates = [];
  const notices = [];
  const matchedItems = [];

  for (const item of reconciliationItems || []) {
    const accountMatch = findAccountForPaymentCandidate(item.paymentAccountCandidate, accounts);
    if (accountMatch.status !== "matched") {
      notices.push(accountMatch.message);
      continue;
    }

    matchedItems.push({ item, account: accountMatch.account });
  }

  const handledItems = new Set();
  for (const group of groupMatchedItems(matchedItems)) {
    const groupUpdates = buildEquivalentGenericProcessorGroupUpdates({
      group,
      transactions,
      categoryHistory,
      createPreviewId,
    });
    if (groupUpdates.length === 0) {
      continue;
    }

    for (const entry of group) {
      handledItems.add(entry.item);
    }
    updates.push(...groupUpdates);
  }

  for (const { item, account } of matchedItems) {
    if (handledItems.has(item)) {
      continue;
    }

    const match = findExistingTransactionForAlipayItem(item, account.id, transactions);
    if (match.status !== "matched") {
      notices.push(match.message);
      continue;
    }

    updates.push(
      buildAlipayTransactionUpdate({
        item,
        transaction: match.transaction,
        categoryHistory,
        createPreviewId,
      }),
    );
  }

  const updatesByTargetId = new Map();
  for (const update of updates) {
    const targetUpdates = updatesByTargetId.get(update.targetId) || [];
    targetUpdates.push(update);
    updatesByTargetId.set(update.targetId, targetUpdates);
  }

  const conflictingTargetIds = new Set();
  for (const [targetId, targetUpdates] of updatesByTargetId) {
    if (targetUpdates.length > 1) {
      conflictingTargetIds.add(targetId);
      notices.push(
        `多条支付宝记录重复指向同一已有流水：${targetUpdates[0].date} ${formatMoney(
          Math.abs(targetUpdates[0].amount),
        )}，已跳过。`,
      );
    }
  }

  return {
    updates: updates.filter((update) => !conflictingTargetIds.has(update.targetId)),
    notices,
  };
}

function groupMatchedItems(matchedItems) {
  const groups = new Map();
  for (const entry of matchedItems) {
    const key = getAlipayGroupKey(entry.item, entry.account.id);
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function getAlipayGroupKey(item, accountId) {
  return [
    accountId,
    item.date,
    roundMoney(Math.abs(Number(item.amount || 0))).toFixed(2),
    item.direction,
  ].join("|");
}

function buildEquivalentGenericProcessorGroupUpdates({
  group,
  transactions,
  categoryHistory,
  createPreviewId,
}) {
  const [{ item, account }] = group;
  const candidates = findAlipayCandidateTransactions(item, account.id, transactions);
  if (candidates.length !== group.length || !candidates.every(isGenericAlipayProcessorTransaction)) {
    return [];
  }

  const supplements = new Set(group.map((entry) => buildAlipaySupplement(entry.item)));
  if (supplements.size !== 1 || ![...supplements][0]) {
    return [];
  }

  const recommendedCategories = new Set();
  for (const entry of group) {
    const recommendation = recommendCategory(`${entry.item.counterparty} ${entry.item.product}`, {
      type: getTransactionType(candidates[0]),
      history: categoryHistory,
    });
    if (
      recommendation.confidence !== "high" ||
      (recommendation.source !== "rule" && recommendation.source !== "user-history")
    ) {
      return [];
    }
    recommendedCategories.add(recommendation.category);
  }

  if (recommendedCategories.size !== 1) {
    return [];
  }

  return candidates.map((transaction, index) =>
    buildAlipayTransactionUpdate({
      item: group[index].item,
      transaction,
      categoryHistory,
      createPreviewId,
    }),
  );
}

function buildAlipayTransactionUpdate({ item, transaction, categoryHistory, createPreviewId }) {
  const supplement = buildAlipaySupplement(item);
  const type = getTransactionType(transaction);
  const recommendation = recommendCategory(`${item.counterparty} ${item.product}`, {
    type,
    history: categoryHistory,
  });
  const nextCategory =
    isFallbackCategory(transaction.category, type) &&
    recommendation.confidence === "high" &&
    (recommendation.source === "rule" || recommendation.source === "user-history")
      ? recommendation.category
      : normalizeTransactionCategory(transaction.category, type, transaction.description);

  return {
    previewId: createPreviewId(),
    targetId: transaction.id,
    date: item.date,
    description: transaction.description,
    nextDescription: appendAlipaySupplement(transaction.description, supplement),
    amount: transaction.amount,
    direction: transaction.direction,
    category: transaction.category,
    nextCategory,
    supplement,
    paymentMethod: item.paymentMethod,
  };
}

function findAccountForPaymentCandidate(candidate, accounts) {
  const displayName = candidate?.displayName || candidate?.accountNumberLast4 || "该付款方式";
  if (!candidate) {
    return { status: "missing", message: "未识别到银行卡付款方式，已跳过。" };
  }

  const fingerprint = String(candidate.accountFingerprint || "").trim();
  if (fingerprint) {
    const exactMatches = accounts.filter((account) => account.accountFingerprint === fingerprint);
    if (exactMatches.length === 1) {
      return { status: "matched", account: exactMatches[0] };
    }
    if (exactMatches.length > 1) {
      return {
        status: "ambiguous",
        message: `识别到${displayName}，但匹配到多个账户，已跳过。`,
      };
    }
  }

  const suffix = String(candidate.accountNumberLast4 || "").trim();
  if (!suffix) {
    return {
      status: "missing",
      message: `识别到${displayName}，但本地没有匹配账户，已跳过。`,
    };
  }

  const matchesById = new Map();
  for (const account of accounts) {
    const hasSuffix = String(account.accountNumberLast4 || "")
      .split("/")
      .includes(suffix);
    const hasMatchingName = (() => {
      const name = String(account.name || "");
      return name.includes(suffix) && (!candidate.institution || name.includes(candidate.institution));
    })();
    if (hasSuffix || hasMatchingName) {
      matchesById.set(account.id, account);
    }
  }

  const matches = [...matchesById.values()];
  if (matches.length === 1) {
    return { status: "matched", account: matches[0] };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      message: `识别到${displayName}，但匹配到多个账户，已跳过。`,
    };
  }
  return {
    status: "missing",
    message: `识别到${displayName}，但本地没有匹配账户，已跳过。`,
  };
}

function findExistingTransactionForAlipayItem(item, accountId, transactions) {
  const candidates = findAlipayCandidateTransactions(item, accountId, transactions);

  if (candidates.length === 0) {
    return {
      status: "missing",
      message: `未找到可补充的已有流水：${item.paymentAccountCandidate?.displayName || item.paymentMethod} ${item.date} ${formatMoney(Math.abs(item.amount))}，已跳过。`,
    };
  }

  const scored = candidates
    .map((transaction) => ({ transaction, score: scoreAlipayDescriptionMatch(transaction, item) }))
    .sort((a, b) => b.score - a.score);
  if (candidates.length === 1) {
    if (scored[0].score >= 100 || isGenericAlipayProcessorTransaction(scored[0].transaction)) {
      return { status: "matched", transaction: scored[0].transaction };
    }
    return {
      status: "ambiguous",
      message: `找到可能匹配的已有流水，但描述匹配不够明确：${item.paymentAccountCandidate?.displayName || item.paymentMethod} ${item.date} ${formatMoney(Math.abs(item.amount))}，已跳过。`,
    };
  }

  const scoreMargin = scored[0].score - scored[1].score;
  if (scored[0].score >= 100 && scoreMargin >= 25) {
    return { status: "matched", transaction: scored[0].transaction };
  }

  return {
    status: "ambiguous",
    message: `找到多条可能匹配的已有流水，但描述匹配不够明确：${item.paymentAccountCandidate?.displayName || item.paymentMethod} ${item.date} ${formatMoney(Math.abs(item.amount))}，已跳过。`,
  };
}

function findAlipayCandidateTransactions(item, accountId, transactions) {
  return transactions.filter((transaction) => {
    const type = getTransactionType(transaction);
    if (type === "transfer" || type === "refunded") {
      return false;
    }
    return (
      transaction.accountId === accountId &&
      transaction.date === item.date &&
      roundMoney(Math.abs(transaction.amount)) === roundMoney(Math.abs(item.amount)) &&
      getTransactionType(transaction) === item.direction
    );
  });
}

function isGenericAlipayProcessorTransaction(transaction) {
  const description = normalizeAlipayMatchText(transaction.description);
  return (
    description.includes("支付宝") &&
    (description.includes("支付宝支付科技有限公司") ||
      description.includes("支付宝 消费") ||
      description === "支付宝")
  );
}

function scoreAlipayDescriptionMatch(transaction, item) {
  const description = normalizeAlipayMatchText(transaction.description);
  if (!description) {
    return 0;
  }

  const candidates = [item.counterparty, item.product]
    .map(normalizeAlipayMatchText)
    .filter(Boolean);
  let score = 0;
  for (const candidate of candidates) {
    if (description === candidate) {
      score = Math.max(score, 200 + candidate.length);
      continue;
    }
    if (description.includes(candidate) && candidate.length >= 4) {
      score = Math.max(score, 160 + candidate.length);
      continue;
    }
    if (candidate.includes(description) && description.length >= 4) {
      score = Math.max(score, 120 + description.length);
      continue;
    }

    const descriptionTokens = new Set(description.split(/\s+/u));
    const candidateTokens = candidate.split(/\s+/u);
    score = Math.max(
      score,
      candidateTokens.filter((token) => token && descriptionTokens.has(token)).length,
    );
  }
  return score;
}

function normalizeAlipayMatchText(value) {
  return String(value || "")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function buildAlipaySupplement(item) {
  return [item.counterparty, item.product]
    .map((part) => String(part || "").replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .filter((part, index, parts) => parts.indexOf(part) === index)
    .join(" - ");
}

function appendAlipaySupplement(description, supplement) {
  const cleanSupplement = String(supplement || "").replace(/\s+/gu, " ").trim();
  const original = String(description || "").trim();
  if (!cleanSupplement || original.includes(`支付宝补充：${cleanSupplement}`)) {
    return original;
  }
  return `${original}；支付宝补充：${cleanSupplement}`;
}

function formatMoney(amount) {
  return `¥${Number(amount || 0).toFixed(2)}`;
}
