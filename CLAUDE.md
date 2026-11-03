# Contabil PJ (Airwallex Agentic Banking Hackathon)

Hackathon build for Track 02, Intent-Bound Purchase Agent: the agent decides annual vs monthly against a cash reserve, and an Airwallex virtual card enforces the decision. **Deadline: Nov 13, 2026, 15:29 (Brasília).**

This repo is a standalone hackathon build, separate from the team's earlier Contabil app (prior work, not part of the submission). Keep Airwallex, card issuing and payment code here only.

## Rules
- **Sandbox only, synthetic data only.** No real bank data or documents. Demo company is in `src/demo/company.ts`; supplier invoices in `src/demo/invoices.ts`; cash news (a flow that moves, e.g. a late retainer) in `src/demo/events.ts`, pinned by `test/policy.test.ts` to make the policy escalate
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
- `POST /simulation/issuing/create` returned `400 bad_request "failed to process transaction"` for every body on Oct 27–28 (a sandbox-side issue other teams hit too; Airwallex acknowledged it in Slack). Fixed on Oct 28: `npm run smoke` passes end to end (EUR → `CURRENCY_NOT_ALLOWED`, MCC 5812 → `MERCHANT_CATEGORY_NOT_ALLOWED`, annual → `LIMIT_EXCEEDED`, monthly → `APPROVED`)

## Hosting
- **Vercel** (`api/index.ts` → `src/server/vercel.ts`): fetch-style handler from `src/server/app.ts`; every API path is rewritten to `/api` (`vercel.json`), static files come from `public/`: the app's web export, built **without** `EXPO_PUBLIC_DEMO_TOKEN` (`bash scripts/export-web.sh`; it moves `assets/node_modules` to `assets/vendor` because Vercel drops node_modules folders. Check the bundle has no token, count only). Judges type the demo token in Settings Each request opens a session over **Upstash Redis** (`RedisProposalStore`, `RedisStateStore`); the function throws if the Redis vars or `DEMO_TOKEN` are missing. Never fall back to disk there
- Local: `npm run server` (node:http adapter, files in `data/`, `DEMO_TOKEN` optional)
- The executor's in-flight map is per process. On serverless a double tap may reach two instances: both create with the same `request_id`, Airwallex rejects the second, and `findCardByDecision` returns the first card. That is the intended path; don't add locking for it
- The cardholder is created lazily on the first card (a request must not block on cardholder polling)
- App settings: `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_DEMO_TOKEN` are EAS environment variables (`scripts/eas-env.sh`), not `app/.env` (EAS ignores it). Tapping *Save and test* in the app stores the values on the device, and stored values win over later updates: after rotating `DEMO_TOKEN`, re-enter it on devices that saved settings
- `ADMIN_TOKEN` (optional; `scripts/vercel-env.sh` creates it): when set, only it can `POST /demo/reset` (403 for the demo token) and it also opens every other route. Never put it in a build or OTA; type it in Settings on the presenter's phone only
- Guards: one pending `issue_card` per offer (`propose_card` refuses a second), approving an `issue_card` when the offer already has a card marks it `stale` (409 `superseded`), and Approve on an `approved`/`executing`/`failed` proposal with the same fingerprint re-runs the executor. `propose_freeze` only targets cards in the demo state and only when the founder asks
- Publish app JS with `npx eas-cli update --branch preview --environment preview` (the `--environment` flag is required non-interactively); check the bundle in `app/dist` contains the API URL before telling anyone
- App UI is in **English** (judges, agent and invoice are English), unlike the production Contabil app

## Before finishing a task
`npm run typecheck` and `npm test`. After changing anything under `src/airwallex/`, also `npm run smoke` (needs `.env`).

## Home screen
- Home is the app's initial route (cash, 12-week projection, issued card, pending approvals); the agent chat is pushed from it. Conversations are saved on the device only (AsyncStorage, `features/chat/services/history.ts`) and listed in History (open, new, delete); the chat opens the picked one or the latest, re-reading proposal statuses from the server. *Reset demo* clears them all; the server never stores messages.
- `GET /cash` returns the policy's cash view (cents) with the issued cards' charges counted; the balance is Halcyon's synthetic cash, not the Airwallex sandbox wallet.
- Palette tokens come from the logo (ivory, espresso, gold); headline numbers use the system serif (`displayFont`). No native modules beyond the installed build, so UI ships by OTA.
