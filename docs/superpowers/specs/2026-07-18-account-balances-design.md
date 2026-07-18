# Account Balances Design

## Goal

Add opening balances to ledger accounts and show the real account balance after each transaction.

## Balance Rule

Each account has an `openingBalance` amount. The balance after a transaction is calculated from:

`openingBalance + all previous transactions for the same account + this transaction`

The dashboard month and account filters only decide which rows are visible. They do not change the meaning of a row balance. A visible row always shows the real account balance immediately after that transaction happened.

## Data Model

Accounts keep the existing fields and add:

- `openingBalance`: number, defaults to `0`

Existing saved accounts without this field are treated as `0` and normalized when saved again. Transactions are not changed. Storing balances on transactions would become stale after deleting rows or editing an account opening balance, so balances are computed at render time.

## User Interface

Account management gets an opening-balance input next to the account name:

- New account form: account name, opening balance, add button.
- Existing account rows: editable account name, editable opening balance, current balance label, delete button.

Transaction records get one extra column:

- `账户余额`: balance of that transaction's account immediately after the row's transaction.

The balance column follows the existing transaction filters and sort order for visibility, but the number itself is calculated from the full history of that account.

## Calculation Details

Balance calculation groups transactions by account. Transactions without an account use the existing unassigned account id. Within each account, transactions are ordered by date ascending and then created time ascending. The running balance is rounded to two decimals after each transaction.

If two transactions have the same date and no created time, their original array order is used as the tie-breaker.

## Error Handling

Opening balance inputs accept decimal numbers. Empty or invalid values are treated as `0` when adding or editing an account. Duplicate account names are still rejected.

Deleting an account keeps the current behavior: affected transactions become unassigned. Their displayed balances are then calculated under the unassigned account with an opening balance of `0`.

## Testing

Add core tests for:

- Running balances use each account's opening balance and independent transaction history.
- Visible filtered rows still show balances computed from hidden earlier rows.
- Existing account records without `openingBalance` remain valid.

Add browser smoke coverage for editing an account opening balance and seeing transaction-row balances update.
