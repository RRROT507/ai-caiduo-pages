# WeChat Miniprogram MVP Design

## Goal

Add a native WeChat Mini Program project for AI财舵 that can be opened in WeChat Developer Tools and submitted as a low-cost personal bookkeeping MVP.

## Scope

The MVP covers manual bookkeeping, account opening balances, cash-flow summary, transaction records, and an import entry point. PDF and AI/OCR bill recognition are not implemented inside the Mini Program runtime yet because reliable PDF parsing needs a cloud OCR/backend path.

## Architecture

The existing hosted web app remains unchanged. A new `miniprogram/` folder contains a native WeChat project using standard `app.json`, page files, local storage, and CommonJS utility modules. The Mini Program core mirrors the stable ledger behavior from the web app: transaction type options, category options, category recommendation rules, filtering, summaries, and running balances.

## Pages

- `pages/index/index`: dashboard, date/account filters, quick entry, and recent transactions.
- `pages/records/records`: all transactions with multi-select deletion.
- `pages/accounts/accounts`: account creation, opening-balance editing, current balance, and deletion.
- `pages/import/import`: bill import entry point with a clear cloud OCR requirement before automatic PDF recognition.

## Data

Accounts and transactions are stored in `wx` local storage under Mini Program-specific keys. Account opening balances are stored on accounts. Transaction row balances are derived from opening balances plus all historical account transactions, not stored on each transaction.

## Testing

Node tests verify the Mini Program project structure and the ledger core behavior shipped under `miniprogram/utils/ledger-core.js`. Manual verification still requires WeChat Developer Tools because this Windows environment cannot run the WeChat simulator.
