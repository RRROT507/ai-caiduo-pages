# Dashboard Colors and Merchant Rules Design

## Goal

Keep cash-flow dashboard colors consistent with transaction row colors, and reduce fallback categories for clear merchant brands found in the user's statement.

## Requirements

- Cash-flow dashboard income amount should be red.
- Cash-flow dashboard expense amount should be green.
- Transaction row colors remain unchanged: income red, expense green, transfer/refunded grey.
- Add conservative high-confidence merchant rules:
  - `喜家德`, `水饺`, `饺子` -> `餐饮`
  - `果蔬好`, `生鲜超市`, `水果店`, `蔬菜` -> `购物`
  - `停简单`, `停车费`, `停车场`, `车场` -> `交通`
- Keep fallback behavior for ambiguous merchants. Do not classify generic words such as `平台`, `商户`, or `好` by themselves.
- Continue using local deterministic rules only; no external lookup is added.

## Implementation Notes

The current app centralizes merchant rules in `assets/ledger-core.mjs` and dashboard colors in `assets/styles.css`. This iteration only extends those existing surfaces and updates tests. No storage migration is required.

## Testing

- Core recommendation tests cover the three reported statement examples.
- Core negative tests ensure generic words do not trigger hard guesses.
- Browser smoke tests cover dashboard income/expense colors.
