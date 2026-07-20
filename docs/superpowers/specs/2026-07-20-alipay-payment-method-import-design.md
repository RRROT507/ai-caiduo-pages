# Alipay Payment Method Import Design

## Goal

Support Alipay transaction statements without double-counting transactions that were actually paid by linked bank cards.

The imported Alipay statement should use the `收/付款方式` column to decide whether a row belongs to the Alipay account, an existing bank account, or should only be shown as a warning.

## Requirements

- Parse Alipay statement PDFs that contain columns such as `收/支`, `交易对方`, `商品说明`, `收/付款方式`, `金额`, and `交易时间`.
- If `收/付款方式` is a bank card or credit card and matches an existing account, do not add a new transaction.
- For matched bank-card rows, try to match an existing transaction by account, date, amount, and direction.
- If an existing transaction is matched, append concise Alipay-side information to that transaction description so the user can see the Alipay statement helped confirm it.
- If the bank card in `收/付款方式` does not match any existing account, show a warning and do not add a transaction.
- If the payment method is Alipay itself, add the row to the Alipay account and include it in Alipay account balance calculations.
- Ignore `不计收支` and zero-amount rows for new transaction creation; they can still appear in warnings or matching notes when useful.
- Keep manual account selection as a fallback only for true Alipay-account rows. It must not cause unmatched bank-card rows to be imported into Alipay.

## Current Statement Observation

The provided statement `支付宝交易明细(20260201-20260331).pdf` extracts as a 5-page Alipay transaction proof. The table has 113 transaction-like rows:

- 110 rows use `招商银行信用卡(1755)` as the payment method.
- 3 rows have empty payment method / zero amount / `不计收支`.
- No effective `支付宝余额`, `余额`, or Alipay-account payment rows were found in this file.

Under this design, this statement should not create Alipay balance transactions. It should only reconcile or annotate matching `招商银行信用卡 尾号1755` transactions when that account exists locally.

## Payment Method Classification

The importer should classify each Alipay row into one of these payment scopes:

- `alipay-account`: payment method clearly means Alipay balance/account, for example `支付宝`, `余额`, or `支付宝余额`.
- `bank-account`: payment method contains a bank/card signal and preferably a suffix, for example `招商银行信用卡(1755)`.
- `unknown`: empty, zero-amount, unsupported, or ambiguous method.

Bank-card methods should expose a candidate:

- `institution`: normalized bank name when known, for example `招商银行`.
- `accountNumberLast4`: card/account suffix, for example `1755`.
- `accountKind`: `credit-card` when the method contains `信用卡`; otherwise `bank-card`.
- `accountFingerprint`: a stable best-effort key such as `cmb-credit-card:1755`.
- `displayName`: readable method, for example `招商银行信用卡 尾号1755`.

## Account Matching

For `bank-account` rows, match the candidate to existing accounts in this order:

1. Exact `accountFingerprint` match.
2. Account `accountNumberLast4` contains the payment suffix, including slash-separated values such as `1755/6746`.
3. Account name contains both the institution signal and suffix, for example `招商银行信用卡` and `1755`.

If no account matches, the row is not importable. The import preview should show a concise notice such as:

`识别到 110 条招商银行信用卡 尾号1755 支付宝记录，但本地没有匹配账户，已跳过。`

## Existing Transaction Matching

For bank-card rows with a matched account, find existing transactions using deterministic local criteria:

- Same matched `accountId`.
- Same calendar date as the Alipay `交易时间`.
- Same absolute amount.
- Direction compatible with `收/支`: `支出` -> expense amount, `收入` -> income amount. `不计收支` should not force a type change.
- Prefer rows whose existing description or merchant key is similar to Alipay `交易对方` or `商品说明`.

If multiple existing rows match equally, do not update any row automatically. Show an ambiguous-match warning instead.

If no existing row matches, do not create a replacement transaction. Show a skipped unmatched warning so the user knows they may need to import the bank statement first.

## Description Annotation

When one existing transaction is matched, append Alipay details to the existing description once.

Format:

`原说明；支付宝补充：交易对方 - 商品说明`

Rules:

- Omit duplicate parts when `交易对方` and `商品说明` are the same.
- Keep the appended text concise; do not include long Alipay order numbers by default.
- Do not append the same Alipay supplement more than once.
- Preserve the original description at the beginning so existing user-entered meaning is not lost.

Example:

- Existing transaction: `高德打车`
- Alipay row: `交易对方=高德打车`, `商品说明=高德打车订单`, `收/付款方式=招商银行信用卡(1755)`
- Updated description: `高德打车；支付宝补充：高德打车 - 高德打车订单`

## Category And Type Assistance

For matched existing transactions, Alipay merchant/product fields can improve recommendations:

- If the existing category is a fallback category, run category recommendation against `交易对方 + 商品说明`.
- If the recommendation is high-confidence and type-compatible, update the category.
- Do not override a non-fallback category.
- Do not change a user-authored transfer/refund type solely from Alipay metadata.
- `不计收支` should not mark a transaction as refunded by itself; refund tagging remains controlled by existing refund-pair logic.

## Alipay Account Rows

Only rows classified as `alipay-account` can create new transactions. Those rows should:

- Use the selected or existing Alipay account.
- Use `支出` / `收入` to set signed amount.
- Use Alipay merchant/product fields for description and category recommendation.
- Participate in Alipay account running balance.

If there is no Alipay account yet, keep the current account selector behavior so the user can choose or create one in the normal account management flow.

## Preview And Confirmation

The import preview should separate outcomes:

- `新增到支付宝账户`: true Alipay-account rows.
- `将补充已有流水`: bank-card rows with exactly one matched existing transaction.
- `已跳过`: unmatched bank accounts, unmatched existing transactions, ambiguous matches, zero-amount rows, and unsupported rows.

Confirmation should:

1. Add only true Alipay-account rows as new transactions.
2. Update matched existing transactions in place with Alipay description supplements and safe category improvements.
3. Never import unmatched bank-card rows into Alipay.

## Testing

Add unit tests for:

- Parsing Alipay statement table rows from extracted text or table-like text.
- Classifying `招商银行信用卡(1755)` as a bank-account candidate.
- Classifying `支付宝余额` / `余额` as Alipay-account.
- Returning no new transactions for bank-card-only statements.
- Matching bank-card rows to existing account suffixes and existing transactions.
- Appending Alipay description supplements idempotently.
- Skipping unmatched bank cards without creating transactions.

Add browser smoke coverage for:

- Uploading an Alipay statement with a bank card that matches an existing transaction and seeing the existing row description updated after confirmation.
- Uploading an Alipay statement with an unmatched card and seeing a warning with no new transaction.
- Uploading an Alipay-account row and seeing it added to the Alipay account with balance calculation.

## Cache

Bump the service worker cache version after implementation so GitHub Pages users receive the updated importer and UI.
