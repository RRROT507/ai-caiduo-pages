# Refunded Transactions, Merchant Rules, and Color Semantics Design

## Goal

Reduce fallback expense categories for well-known merchants, automatically mark fully refunded same-day transactions, and align transaction colors with the user's requested convention.

## Requirements

- `财付通-PIZZAHUT` and common clearly identifiable dining brands should recommend `餐饮` with high confidence.
- Merchant rules must stay conservative: add brand names and strong dining tokens, not broad ambiguous tokens.
- Same-date, same-account, cleaned-description-matched, equal-absolute-amount opposite-sign pairs should be marked as `已退款`.
- Refunded transactions should use a dedicated transaction type value `refunded`, category `已退款`, grey styling, and should not count toward income, expense, balance, or expense category totals.
- Refunded rows should remain visible in transaction records so the user can audit what happened.
- Transfer rows remain grey and continue to be excluded from cash-flow totals.
- Transaction record colors should be: expense green, income red, transfer grey, refunded grey.

## Architecture

The existing ledger core already normalizes transaction types, categories, summaries, and transfer tagging. This change extends that pipeline with a `refunded` type and a refund-tagging pass that runs after transfer detection. UI rendering continues to derive labels, category options, and CSS classes from normalized transaction type.

Merchant recommendations remain local-only and deterministic. No external merchant lookup is added in this iteration because the app is a static GitHub Pages frontend and should not expose API keys or send private transaction descriptions to third-party services without a backend and consent flow.

## Detection Rules

Refund matching uses strict criteria:

- both transactions have valid same `date`
- both transactions have the same `accountId`, treating missing account as unassigned
- descriptions match after trimming payment-channel prefixes and branch/location parentheses
- rounded amounts have opposite signs and identical absolute value
- neither row is already an explicit transfer

If multiple possible matches exist, pair each row at most once using stable transaction order.

## Testing

- Core tests cover `PIZZAHUT` and other representative brand recommendations.
- Core tests cover refunded pair tagging and cash-flow exclusion.
- Browser tests cover grey refunded rows and the requested red/green color convention.
