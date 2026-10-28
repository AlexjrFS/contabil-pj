# Contabil PJ (Airwallex Agentic Banking Hackathon)

Hackathon build for Track 02, Intent-Bound Purchase Agent: the agent decides annual vs monthly against a cash reserve, and an Airwallex virtual card enforces the decision. **Deadline: Nov 13, 2026, 15:29 (Brasília).**

This repo is separate from the production Contabil app (`../contabil`). Never add Airwallex, card issuing or payment code to the production app. Plan, task list and decisions live in the Contabil vault: `../contabil/vault/02 - Produto/Hackathon Airwallex.md` and `Melhorias hackathon.md`.

## Rules
- **Sandbox only, synthetic data only.** No real bank data, names or documents. Demo company is in `src/demo/company.ts`
- **Money is integer cents** everywhere. Convert to major units only at the Airwallex boundary (`toMajor` in `src/policy/money.ts`)
- **The model never computes amounts and never holds credentials.** Amounts, limits, reserves and state transitions are computed in `src/policy/`. The model calls typed tools and can only *propose* actions; code executes them after the user approves, with the approval bound to amount, currency, merchant category and merchant
- **Idempotency:** each new operation gets a new `request_id`; retries of the same operation reuse it. Card creation uses the approved decision id
- **Approvals** (`src/approvals/`): the agent proposes by id (`proposeCard(offerId)`, `proposeCardUpdate`, `proposeFreeze`); terms always come from `termsFor` (offer + policy). `approve` needs the fingerprint the founder saw. The executor re-checks the policy before running (`stale` if the terms changed) and is the only code that calls card create/update. Never give the model a tool that executes
- **Agent** (`src/agent/`): tools are read-only or `propose_*` by id; `test/agent.test.ts` pins the tool names and that the only parameters are `offer_id`, `card_id`, `invoice_id`, `reason`. Proposals reach the UI through `onProposal`, not the model's text. Invoice notes go to the model inside `<untrusted_supplier_text>`. Model `claude-haiku-5-5` by default (matched Opus 5.5 on the demo scenes, ~40x cheaper, faster); override with `ANTHROPIC_MODEL`. Adaptive thinking, effort medium; server-side refusal fallback only on models that support it
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
- A reused `request_id` on card create returns `400 invalid_argument` with `source: request_id`, **not** the original card. The executor recovers by listing the cardholder's cards and matching `metadata.decision_id` (list items carry no metadata, so each card is read)
- Card update (full controls) and freeze/unfreeze (`card_status`) verified
- **Open:** `POST /simulation/issuing/create` returns `400 bad_request "failed to process transaction"` for every body tried (with/without version header, MCC, 43-char merchant_info, single/two phase, card_number) and even on a card with no currency/MCC controls. To ask in Slack #help (support is Slack-only during the hackathon)

## Hosting
- **Vercel** (`api/index.ts` → `src/server/vercel.ts`): fetch-style handler from `src/server/app.ts`; every API path is rewritten to `/api` (`vercel.json`), static files (the web app later) come from `public/`. Each request opens a session over **Upstash Redis** (`RedisProposalStore`, `RedisStateStore`); the function throws if the Redis vars or `DEMO_TOKEN` are missing. Never fall back to disk there
- Local: `npm run server` (node:http adapter, files in `data/`, `DEMO_TOKEN` optional)
- The executor's in-flight map is per process. On serverless a double tap may reach two instances: both create with the same `request_id`, Airwallex rejects the second, and `findCardByDecision` returns the first card. That is the intended path; don't add locking for it
- The cardholder is created lazily on the first card (a request must not block on cardholder polling)
- App UI is in **English** (judges, agent and invoice are English), unlike the production Contabil app

## Before finishing a task
`npm run typecheck` and `npm test`. After changing anything under `src/airwallex/`, also `npm run smoke` (needs `.env`).
