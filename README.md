# Contabil PJ

**The model explains. Code decides. The card enforces.**

An AI finance agent for small businesses that pay global suppliers. It decides *how* to pay for a purchase (annual or monthly) against a cash reserve, then turns the approved decision into an Airwallex virtual card whose controls decline everything else.

Built for the [Airwallex Agentic Banking Hackathon](https://airwallex.hackerearth.com/), Track 02 (Intent-Bound Purchase Agent).

> Work in progress. This repository grows during the build phase (Oct 27 – Nov 13, 2026).

## How it works

1. **Code projects cash** week by week against a reserve floor (`src/policy/cash.ts`). In the demo company, annual billing saves 18% but breaks the reserve in week 7, so the policy picks monthly and sets a date to revisit.
2. **The decision becomes card controls** (`src/policy/card.ts`): a per-transaction and monthly limit equal to the price, a USD-only currency allowlist and the vendor's merchant category.
3. **The card enforces it.** Simulated charges show the monthly charge clearing while the annual charge (`LIMIT_EXCEEDED`), a charge in another currency (`CURRENCY_NOT_ALLOWED`) and a charge at another merchant category (`MERCHANT_CATEGORY_NOT_ALLOWED`) are declined.
4. **New terms mean a new approval.** When the price changes, the card declines the new amount until the founder approves an update.

The language model never computes amounts and never holds credentials: it calls typed tools and can only *propose* actions, which run after the founder approves them.

## Setup

Requirements: Node.js 22+, an [Airwallex sandbox account](https://www.sandbox.airwallex.com/global/signup).

```bash
npm install
cp .env.example .env   # fill in AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY
npm test               # policy and client tests (no network)
npm run smoke          # end-to-end run against the Airwallex sandbox
npm run chat -- "Should we buy Framewise annual or monthly?"   # needs ANTHROPIC_API_KEY
npm run chat -- --after-invoice "Read the December invoice from Framewise"
npm run server         # HTTP API for the app on :3000 (state in data/)
```

Sandbox API keys: Account > Developer > API keys (scoped key, Read + Write). All data is synthetic; nothing touches real money.

### App

The Expo app (SDK 58) lives in `app/`: chat with the agent, confirmation cards, the card screen with test charges, and scenario controls.

```bash
cd app
npm install
npx expo start         # press w for web, or scan the QR code with Expo Go
```

It talks to `EXPO_PUBLIC_API_URL` (default: the API on the same machine, port 3000) with the demo token `EXPO_PUBLIC_DEMO_TOKEN`; both can be changed in the app's Settings screen.

### Hosting

The API runs on Vercel (`api/index.ts`), with Upstash Redis for proposals and scenario state. `bash scripts/vercel-env.sh` copies the secrets from `.env` to the Vercel project. Every route except `/health` requires `Authorization: Bearer <DEMO_TOKEN>`; the token is baked into the private demo builds.

## Project layout

| Path | What it does |
|---|---|
| `src/airwallex/client.ts` | REST client: token cache, per-call API version, 429 backoff, concurrency cap |
| `src/airwallex/api.ts` | Typed wrappers for balances, global accounts, issuing and simulation endpoints |
| `src/policy/cash.ts` | Weekly cash projection and annual vs monthly decision |
| `src/policy/card.ts` | Decision → card controls (create and update) |
| `src/approvals/proposals.ts` | Proposals with terms computed by the policy; approval bound to a fingerprint of amount, currency, merchant category and merchant |
| `src/approvals/executor.ts` | Runs approved proposals once (proposal id = `request_id`), re-checks the policy first, recovers after a crash |
| `src/approvals/store.ts` | Proposal storage (JSON file, in-memory for tests) |
| `src/approvals/invoices.ts` | Applies a supplier invoice to an offer from its structured fields only |
| `src/agent/tools.ts` | The model's tools: read cash, plans, invoices and cards; propose by id. No tool approves or executes |
| `src/agent/chat.ts` | Claude tool-runner loop that streams text and hands proposals to the app |
| `src/app/session.ts` | Demo session: shared policy context, executor and scenario state (cardholder, cards, invoices) persisted in `data/` |
| `src/server/app.ts` | HTTP API: streamed chat (NDJSON), approve/reject, card, invoice arrival, named test charges, reset |
| `src/server/vercel.ts`, `api/index.ts` | Vercel entry: Redis-backed session per request, demo token required |
| `app/` | Expo app (chat, confirmation card, card screen, settings) |
| `src/demo/company.ts` | Synthetic demo company and SaaS offer |
| `src/demo/invoices.ts` | Price-increase invoice with a hidden prompt injection in its note |
| `scripts/smoke.ts` | End-to-end sandbox run |

## Team

Halcyontech: Alex Junior Fortunato Sacramento, André Fernandes Moreira Nascimento.
