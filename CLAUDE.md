# Contabil PJ (Airwallex Agentic Banking Hackathon)

Hackathon build for Track 02, Intent-Bound Purchase Agent: the agent decides annual vs monthly against a cash reserve, and an Airwallex virtual card enforces the decision. **Deadline: Nov 13, 2026, 15:29 (Brasília).**

This repo is separate from the production Contabil app (`../contabil`). Never add Airwallex, card issuing or payment code to the production app. Plan, task list and decisions live in the Contabil vault: `../contabil/vault/02 - Produto/Hackathon Airwallex.md` and `Melhorias hackathon.md`.

## Rules
- **Sandbox only, synthetic data only.** No real bank data, names or documents. Demo company is in `src/demo/company.ts`
- **Money is integer cents** everywhere. Convert to major units only at the Airwallex boundary (`toMajor` in `src/policy/money.ts`)
- **The model never computes amounts and never holds credentials.** Amounts, limits, reserves and state transitions are computed in `src/policy/`. The model calls typed tools and can only *propose* actions; code executes them after the user approves, with the approval bound to amount, currency, merchant category and merchant
- **Idempotency:** each new operation gets a new `request_id`; retries of the same operation reuse it. Card creation uses the approved decision id
- **Secrets** only in `.env` (gitignored). Never commit or print them
- Code, comments and README in **English** (judges read the repo). Chat with the user in pt-BR
- The demo numbers are pinned by `test/policy.test.ts` (annual saves 18%, breaks the reserve in week 7). The video narration depends on them: don't change one without the other

## Airwallex notes (verified against the API reference)
- Sandbox base URL `https://api.sandbox.airwallex.com`; login `POST /api/v1/authentication/login` with `x-client-id` and `x-api-key`, token ~30 min
- `x-api-version` only on calls that ask for it (simulation create); never on FX calls
- Capture and reverse use `/simulation/issuing/card_transaction_lifecycles/{lifecycle_id}/capture|reverse`
- Simulation create answers `process_result` + `failure_reason` synchronously; simulation currencies do not include BRL
- Card update must resend the full controls (`allowed_merchant_categories` resets to `[]`; `transaction_limits` needs both `limits` and `cash_withdrawal_limits`). Freeze = `card_status: INACTIVE`
- Limits are inclusive; `PER_TRANSACTION` is not cumulative, so pair it with `MONTHLY` or `ALL_TIME`
- Fund the wallet first or every authorization declines with `INSUFFICIENT_FUNDS` (new sandbox accounts already start with USD balance)

## Sandbox findings (Oct 27)
- Admin API keys are no longer provisioned for new accounts; we use a scoped key (Read + Write on everything, single account, so no `x-login-as`)
- Login, balances, global account, deposit, cardholder (PENDING → READY on its own) and card create all work
- The account only allows card program `CREDIT` / `GOOD_FUNDS_CREDIT`; `PREPAID` and `DEBIT` are rejected with `invalid_argument`
- **Open:** `POST /simulation/issuing/create` returns `400 bad_request "failed to process transaction"` for every body tried (with/without version header, MCC, 43-char merchant_info, single/two phase, card_number) and even on a card with no currency/MCC controls. Asked in Slack #help

## Before finishing a task
`npm run typecheck` and `npm test`. After changing anything under `src/airwallex/`, also `npm run smoke` (needs `.env`).
