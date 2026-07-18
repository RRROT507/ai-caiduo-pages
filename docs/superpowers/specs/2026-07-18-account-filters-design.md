# Account Filters Design

## Goal

Add lightweight account management to AI财舵 so each transaction can be tagged with an account, and the cash flow dashboard can summarize by selected account and one or more selected months.

## Scope

- Add an account management module for local account names.
- Let manually created transactions choose an account.
- Let imported transactions default to an account chosen during import, while still allowing the user to review categories before saving.
- Add account filtering to the cash flow dashboard and transaction list.
- Replace the dashboard's single-month view with a month multi-select that can summarize several months at once.
- Preserve existing browser-local data. Old transactions without an account show as `未指定账户`.

## Non-Goals

- No account balance calculation.
- No credit card repayment matching.
- No asset, liability, or net worth model.
- No bank login or direct bank integration.
- No cloud sync.

## Data Model

Accounts are stored locally in a new `ai-caiduo-accounts-v1` localStorage key.

Each account has:

- `id`: stable generated id.
- `name`: user-visible account name.
- `createdAt`: ISO timestamp.

Transactions gain an optional `accountId` field. When a transaction has no `accountId`, UI renders it under `未指定账户`.

The app seeds a small default account set on first run:

- `招商信用卡`
- `微信`
- `支付宝`
- `现金`

## User Flow

1. User opens the account module and sees existing accounts.
2. User adds, renames, or deletes local account names.
3. User manually adds a transaction and selects an account.
4. User imports a statement, selects an import account, previews recognized rows, then confirms them into that account.
5. User uses the dashboard controls to select multiple months and one or more accounts.
6. Summary cards, category bars, transaction list, and CSV export reflect the active filters.

## UI Design

Add a compact `账户管理` panel beside the current quick-entry and import panels.

Dashboard controls become:

- A month checklist populated from existing transaction months plus the current month.
- An account multi-select checklist with `全部账户` behavior.

Manual entry adds an `账户` select field. Import adds an `入账账户` select near the upload controls.

The transaction table adds an `账户` column. On mobile, the account appears as one row field in each stacked transaction card.

## Behavior Rules

- Account names must be non-empty after trimming.
- Duplicate account names are rejected case-sensitively after trimming.
- Deleting an account does not delete transactions. Existing transactions for that account become `未指定账户`.
- If all month checkboxes are cleared, the app re-selects the current month.
- If all account filters are cleared, the app treats it as all accounts.
- Imported rows inherit the selected import account at confirmation time.
- CSV export adds an `账户` column.

## Architecture

- `assets/ledger-core.mjs` adds pure helpers for multi-month/account filtering and summaries.
- `assets/app.js` owns account storage, account UI, manual/import account assignment, and rendering.
- `index.html` adds the account panel, account selectors, multi-month controls, and account table column.
- `assets/styles.css` adds compact checklist and account-management styles while preserving the existing static PWA layout.
- `service-worker.js` cache version is bumped so deployed users receive the new scripts.

## Error Handling

- Empty account name: show inline status in the account panel.
- Duplicate account name: show inline status in the account panel.
- Rename/delete actions immediately refresh filters and visible rows.
- Stored malformed accounts are ignored on load.
- Stored malformed transactions continue to be filtered by the existing transaction validator.

## Testing

- Unit test dashboard summary across multiple months.
- Unit test account filtering including `未指定账户`.
- Unit test CSV export includes account names.
- Browser smoke test account creation, manual transaction account selection, multi-month dashboard selection, account filter, and visible table rows.
- Existing importer and ledger-core tests must continue to pass.
