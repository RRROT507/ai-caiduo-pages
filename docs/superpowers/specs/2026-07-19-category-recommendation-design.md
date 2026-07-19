# Category Recommendation Design

## Goal

Reduce transactions falling into `其他支出` while avoiding fabricated categories. Category recommendations must be explainable, local-first, and conservative when confidence is low.

## Scope

- Improve local category inference for manual entry, text/PDF import fallback parsing, and AI import normalization.
- Learn from the user's prior confirmed/manual categories for the same merchant.
- Clean payment-channel noise from statement descriptions before matching rules.
- Keep low-confidence transactions in the fallback categories rather than forcing a guess.

## Non-Goals

- No live merchant lookup in this step. The app is currently hosted as static GitHub Pages, so direct lookup would either expose API keys or send private transaction descriptions to third parties without a backend consent layer.
- No new categories in this step. The existing expense, income, and transfer category lists remain the allowed output set.
- No automatic cloud sync of user learning data.

## Recommendation Pipeline

The core module should expose a recommendation object instead of only returning a category string:

- `category`: one of the allowed categories for the transaction type.
- `confidence`: `high`, `medium`, or `low`.
- `source`: `user-history`, `rule`, `fallback`, or `transfer`.
- `merchant`: normalized merchant key when one can be extracted.

The existing `inferCategory(description, direction)` API should remain as a compatibility wrapper returning only `category`.

For an expense transaction, the pipeline should run in this order:

1. Normalize the transaction type. Transfer still always returns `转账`.
2. Clean the description to remove payment-channel noise such as `财付通-`, `支付宝-`, card suffixes, account numbers, and bracketed branch names.
3. Check user history for a matching merchant key. Use the user's repeated prior category only when it is valid for the current type.
4. Apply high-certainty merchant/keyword rules. Rules must target specific merchant/business signals, not broad payment channels.
5. Return `其他支出` with low confidence if no reliable match exists.

Income recommendations follow the same shape but stay focused on deterministic income keywords: salary, bonus, reimbursement, refund, interest, and investment income.

## User Learning

The app should derive learning data from saved transactions:

- Only non-transfer transactions with valid categories can teach the model.
- Fallback categories (`其他支出`, `其他收入`) should not teach merchant-specific rules.
- A merchant with at least two matching prior transactions in the same category can be used as a high-confidence recommendation.
- A merchant with one prior transaction can be a medium-confidence recommendation.

Manual entries and imported rows confirmed by the user are both saved transactions, so they can both improve future recommendations. If the user later changes categories in future work, those saved categories naturally update the next derived history snapshot.

## UI Behavior

- Quick entry should still update the category select as the user types a description.
- Import preview should receive normalized categories from the importer as before.
- No low-confidence warning UI is required in this step; uncertainty is represented by keeping the fallback category.

## Testing

- Core tests should cover merchant extraction, payment-channel cleanup, user-history learning, low-confidence fallback, and type-safe category normalization.
- Importer tests should verify cleaner statement descriptions produce better categories.
- Browser smoke tests should verify a previously saved merchant category influences later quick-entry suggestions.
