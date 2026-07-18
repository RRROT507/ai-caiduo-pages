# File AI Import Design

## Goal

Replace the text-paste import surface with a file-upload flow where the user selects a local bank statement, reviews recognized transactions, and confirms them into the local ledger.

## Scope

- The first public Web version must show an upload-first flow, not a paste-text area.
- The first supported path is China Merchants Bank style statement content that can be represented as text.
- The static GitHub Pages app must not contain an AI API key.
- The app must expose a clean backend handoff point for a future AI parsing service.
- If no backend endpoint is configured, the app may run local text extraction and rule parsing as a temporary fallback.
- Transactions recognized from a file must be shown as a pending preview before they are saved.

## Non-Goals

- No bank login.
- No direct bank account connection.
- No long-term upload or storage of original statement files.
- No OCR for scanned image PDFs in this static-only step.
- No hidden front-end AI key.

## User Flow

1. User opens AI财舵 and selects a local statement file.
2. User clicks recognition.
3. App extracts file content locally and, when configured, sends the file or extracted content to a secure AI import endpoint.
4. App shows a pending transaction preview with date, description, category, type, and amount.
5. User confirms to save recognized records into browser-local storage.
6. User can discard the preview without saving.

## Architecture

- `index.html` owns the upload and pending-preview markup.
- `assets/app.js` owns UI state, event binding, pending preview, and local ledger persistence.
- `assets/ledger-importer.mjs` owns file reading, optional AI endpoint handoff, local fallback parsing, and transaction normalization.
- `assets/ledger-core.mjs` remains the shared transaction parsing, categorization, summary, and CSV module.

## Error Handling

- No file selected: show a short inline message.
- Unsupported or unreadable file: show a short inline message.
- AI endpoint unavailable or unconfigured: use local fallback if text can be extracted.
- No transactions recognized: show a short inline message and do not save anything.
- Recognized transactions are never saved until the user confirms.

## Testing

- Unit test file importer fallback from a local statement text file.
- Unit test AI endpoint response normalization.
- Browser smoke test upload, recognition preview, confirmation, and local ledger row creation.
- Existing ledger-core tests must continue to pass.
