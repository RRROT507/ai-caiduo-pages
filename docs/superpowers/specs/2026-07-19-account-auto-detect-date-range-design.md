# Account Auto-Detection And Date Range Design

## Goal

Improve statement import and dashboard filtering:

- Detect the bank account represented by an imported statement and assign imported transactions to that account automatically.
- Prompt the user to add the account when the statement identifies a bank account that is not already saved.
- Replace month-only dashboard filtering with a single date-range selector that works at day precision.

## Scope

- Support account detection for locally parsed China Merchants Bank transaction statements first.
- Keep the current manual account selector as a fallback and correction tool.
- Keep all original transaction balance rules: row balances are real account balances after each transaction, independent of the visible filter period.
- Store only account metadata needed for matching. Do not store the original statement file.

## Non-Goals

- No bank login or direct bank connection.
- No automatic merging of duplicate accounts beyond deterministic local matching.
- No calendar sync or recurring date ranges.
- No OCR-only account detection for scanned PDFs in this step.

## Account Detection

The importer should return statement metadata in addition to transactions:

- `institution`: bank name, for example `招商银行`.
- `accountName`: readable suggested account name.
- `accountFingerprint`: stable match key derived from institution and account number suffix when available.
- `accountNumberLast4`: account number suffix when available.
- `openingBalanceEstimate`: optional amount inferred from the first parsed transaction and its post-transaction balance.

For China Merchants Bank transaction statements, the parser can read the account number from the statement header and use the transaction amount plus balance column to estimate the opening balance immediately before the first parsed transaction:

`openingBalanceEstimate = firstRowBalance - firstRowAmount`

The estimate is only used when creating a new account. Existing account opening balances are not overwritten automatically.

## Matching Rules

When a file is recognized:

1. If `accountFingerprint` matches an existing account, import preview rows default to that account.
2. If no fingerprint match exists, but an existing account name exactly matches the suggested account name, use that account.
3. If no match exists, show a pending new-account prompt in the import preview.
4. If statement metadata is missing, keep the current import-account selector behavior.

Accounts should add optional fields:

- `institution`
- `accountNumberLast4`
- `accountFingerprint`

Existing accounts without these fields remain valid.

## Import Flow

After recognition, the import preview should show the detected account state:

- Matched account: show the matched account name and let the user change it from the account selector.
- New account: show a prompt to add the detected account before confirmation.
- Unknown account: show the account selector and default to the current fallback account.

When confirming import:

- If a new detected account is accepted, create it first using the suggested name, fingerprint fields, and `openingBalanceEstimate` when available.
- Then assign imported transactions to that account.
- If the user declines the new account prompt, import rows use the selected fallback account.

The pending preview should still avoid saving anything until the user confirms.

## Date Range Filter

Replace the two month inputs with one date-range control:

- Closed display value: `YYYY-MM-DD 至 YYYY-MM-DD`.
- Opening the control shows a calendar-style day picker.
- First date click sets the start date.
- Second date click sets the end date.
- If the second date is earlier than the first date, swap the two dates.
- After the second click, close the panel and refresh the dashboard.

The selector should initialize to the current month range:

- Start: first day of the current month.
- End: today.

## Filtering Rules

Core ledger filtering should move from month keys to date boundaries:

- Include a transaction when `startDate <= transaction.date <= endDate`.
- Account filtering continues to work the same way.
- Export filenames use the selected date range.

Existing summary helpers may keep month support only if needed by tests, but dashboard rendering should use day-precision date range filters.

## User Interface

Dashboard filters:

- Replace `开始月份` and `结束月份` with one `周期` control.
- Keep the account dropdown next to it.
- Calendar panel should be compact and keyboard-safe enough for desktop/mobile use.

Import preview:

- Keep account selection visible.
- Add a small detected-account status area above pending rows.
- Avoid modal dialogs for normal import confirmation; use inline controls so the user can review rows and account choice together.

## Error Handling

- If account metadata is partial, show the readable account name when available and fall back to manual account selection.
- If the suggested new account name duplicates an existing account name, append the account suffix, for example `招商银行 尾号3598`.
- If opening balance cannot be estimated, create the account with `0`.
- Invalid or missing transaction dates are excluded from date-range filtering.

## Testing

Add unit tests for:

- China Merchants Bank transaction statement metadata extraction.
- Account matching by fingerprint and fallback by account name.
- Date-range filtering includes boundary dates and excludes outside dates.
- Existing month-based parsing behavior does not regress where still used.

Add browser smoke coverage for:

- Uploading a statement that matches or creates an account.
- Confirming import assigns rows to the detected account and shows account balances.
- Selecting a day-level date range from one control and seeing dashboard rows update.
