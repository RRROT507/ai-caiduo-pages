# Dashboard Filter Refinement Design

## Goal

Refine the cash flow dashboard filters so the existing month input controls a continuous month range, and account filtering uses a compact dropdown instead of checkbox pills.

## Scope

- Remove the added month checkbox filter area from the dashboard.
- Replace the single `添加月份` month input with two month inputs: `开始月份` and `结束月份`.
- The dashboard summarizes every continuous month between the start and end months, inclusive.
- Replace account checkbox pills with one account dropdown.
- The account dropdown options are `全部账户`, `未指定账户`, and all locally managed accounts.
- Summary cards, expense category bars, transaction rows, and CSV export follow the month range and selected account.
- Preserve existing account management, manual account selection, import account selection, and imported transaction behavior.

## Behavior Rules

- If the user chooses a start month after the end month, the app normalizes the range by sorting the two months.
- If either month input is empty, it falls back to the current month.
- Selecting `全部账户` clears account filtering.
- Selecting one account filters to that account only.
- Deleted accounts still make old transactions appear under `未指定账户`.

## Architecture

- `assets/ledger-core.mjs` keeps the existing `filterLedgerTransactions` and `summarizeSelection` helpers.
- `assets/app.js` changes dashboard state from selected-month and selected-account arrays to `startMonth`, `endMonth`, and `selectedAccountId`.
- `index.html` replaces dashboard filter markup with start/end month controls and an account dropdown.
- `assets/styles.css` removes checkbox pill styling from this surface and adds compact range/dropdown filter layout.
- `tests/legacy-browser-smoke.test.mjs` verifies the browser-visible interaction.
- `service-worker.js` cache version is bumped for deployed users.

## Testing

- Browser smoke test verifies no month checkbox list remains.
- Browser smoke test verifies two month inputs can summarize July through August.
- Browser smoke test verifies the account dropdown filters to `微信` and `支付宝`.
- Existing unit and importer tests continue to pass.
