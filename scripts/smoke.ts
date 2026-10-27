// End-to-end check against the Airwallex sandbox: funding → cardholder → decision → approved card → authorizations → re-plan.
// Run with `npm run smoke` after filling .env. Every step prints what it did; nothing here touches real money.
import { randomUUID } from 'node:crypto'
import { airwallexApi, type CardTransactionResult } from '../src/airwallex/api.js'
import { AirwallexClient, AirwallexError } from '../src/airwallex/client.js'
import { createExecutor } from '../src/approvals/executor.js'
import { approve, proposeCard, proposeCardUpdate, proposeFreeze, type PolicyContext } from '../src/approvals/proposals.js'
import { MemoryStore } from '../src/approvals/store.js'
import { cashPosition, COMPANY, OFFERS, SAAS_OFFER } from '../src/demo/company.js'
import { comparePlans } from '../src/policy/cash.js'
import { cents, formatUSD, toMajor } from '../src/policy/money.js'

const api = airwallexApi(AirwallexClient.fromEnv())
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const step = (text: string) => console.log(`\n▶ ${text}`)

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, attempts = 10): Promise<T> {
  let value = await read()
  for (let i = 1; i < attempts && !done(value); i++) {
    await sleep(2_000)
    value = await read()
  }
  return value
}

async function fund(): Promise<void> {
  step('Funding the USD wallet')
  const before = (await api.balances()).find((b) => b.currency === 'USD')
  if ((before?.available_amount ?? 0) >= 25_000) {
    console.log(`  USD available: ${before?.available_amount}; no deposit needed`)
    return
  }
  let accountId = process.env.AIRWALLEX_GLOBAL_ACCOUNT_ID
  if (!accountId) {
    const account = await api.createGlobalAccount({
      request_id: randomUUID(),
      country_code: 'US',
      currency: 'USD',
      nick_name: 'Contabil PJ demo',
    })
    accountId = account.id
    console.log(`  created global account ${accountId} (${account.status}); set AIRWALLEX_GLOBAL_ACCOUNT_ID to reuse it`)
  }
  const deposit = await api.simulateDeposit({ global_account_id: accountId, amount: 25_000, payer_name: 'Seed funding' })
  console.log(`  simulated deposit ${deposit.amount} ${deposit.currency} (${deposit.status})`)
  const usd = (await api.balances()).find((b) => b.currency === 'USD')
  console.log(`  USD available: ${usd?.available_amount ?? 0}`)
}

async function cardholder(): Promise<string> {
  step('Creating the cardholder')
  const created = await api.createIndividualCardholder({
    email: `founder+${Date.now()}@example.com`,
    first_name: COMPANY.founder.first_name,
    last_name: COMPANY.founder.last_name,
    date_of_birth: '1990-05-14',
    address: { line1: '500 Howard St', city: 'San Francisco', state: 'CA', postcode: '94105', country: 'US' },
  })
  console.log(`  ${created.cardholder_id}: ${created.status}`)
  let holder = await waitFor(() => api.getCardholder(created.cardholder_id), (h) => h.status === 'READY')
  if (holder.status !== 'READY') {
    console.log(`  still ${holder.status}; using the sandbox pass_review fallback`)
    await api.passCardholderReview(created.cardholder_id)
    holder = await waitFor(() => api.getCardholder(created.cardholder_id), (h) => h.status === 'READY')
  }
  if (holder.status !== 'READY') throw new Error(`Cardholder stuck in ${holder.status}`)
  console.log('  READY')
  return holder.cardholder_id
}

interface Expectation {
  label: string
  amount: number
  currency: string
  mcc: string
  expect: 'APPROVED' | string
}

async function run(): Promise<void> {
  step('Login and balances')
  console.log(`  ${(await api.balances()).length} balance(s) visible`)

  await fund()
  const holderId = await cardholder()

  step('Deciding in code: annual vs monthly against the reserve floor')
  const comparison = comparePlans(cashPosition(), SAAS_OFFER)
  console.log(`  annual saves ${comparison.savingsPercent}% (${formatUSD(comparison.savingsPerYear)}/year)`)
  console.log(`  annual first breaches the reserve in week ${comparison.annual.firstBreachWeek ?? '-'}`)
  console.log(`  monthly lowest balance ${formatUSD(comparison.monthly.lowest)}`)
  const rec = comparison.recommendation
  if (rec.kind !== 'buy') throw new Error(`Policy escalated: ${rec.reason}`)
  console.log(`  decision: ${rec.plan} (${rec.reason}), revisit on ${rec.revisitOn ?? '-'}`)

  let mismatches = 0

  step('Proposing the card, approving it and executing it')
  const store = new MemoryStore()
  const ctx: PolicyContext = { position: cashPosition, offers: { ...OFFERS } }
  const executor = createExecutor({
    store,
    cards: api,
    ctx,
    cardholderId: holderId,
    createdBy: `${COMPANY.founder.first_name} ${COMPANY.founder.last_name}`,
  })
  const proposed = await proposeCard(store, ctx, 'framewise')
  if (proposed.kind !== 'proposal') throw new Error(`Policy escalated: ${proposed.reason}`)
  const { proposal } = proposed
  const { terms } = proposal.action as { terms: { plan: string; amount: number } }
  console.log(`  proposal ${proposal.id}: ${terms.plan} at ${formatUSD(terms.amount)}`)
  await approve(store, ctx, proposal.id, proposal.fingerprint)
  const executed = await executor.execute(proposal.id)
  if (executed.status !== 'executed') throw new Error(`Execution ${executed.status}: ${executed.error?.message ?? ''}`)
  const again = await executor.execute(proposal.id)
  console.log(`  executed (attempts ${executed.attempts}); second execute returned the same card: ${again.result?.cardId === executed.result?.cardId}`)
  // Pretend the process stopped after Airwallex created the card but before the result was saved
  await store.save({ ...executed, status: 'executing', result: undefined })
  const recovered = await executor.execute(proposal.id)
  const recoveredOk = recovered.status === 'executed' && recovered.result?.cardId === executed.result?.cardId
  if (!recoveredOk) mismatches++
  console.log(`  ${recoveredOk ? '✓' : '✗'} crash recovery found the same card (${recovered.status})`)
  const card = await waitFor(() => api.getCard(executed.result!.cardId), (c) => c.card_status === 'ACTIVE')
  console.log(`  card ${card.card_id}: ${card.card_status}`)
  if (card.card_status !== 'ACTIVE') throw new Error(`Card stuck in ${card.card_status}`)

  step('Simulating charges against the card')
  const price = toMajor(SAAS_OFFER.monthlyPrice)
  // Declines first: the approved charge uses up this month's cap
  const cases: Expectation[] = [
    { label: 'wrong currency (EUR)', amount: price, currency: 'EUR', mcc: SAAS_OFFER.merchantCategoryCode, expect: 'CURRENCY_NOT_ALLOWED' },
    { label: 'other merchant category (restaurant)', amount: price, currency: 'USD', mcc: '5812', expect: 'MERCHANT_CATEGORY_NOT_ALLOWED' },
    { label: 'annual charge', amount: toMajor(SAAS_OFFER.annualPrice), currency: 'USD', mcc: SAAS_OFFER.merchantCategoryCode, expect: 'LIMIT_EXCEEDED' },
    { label: 'monthly charge', amount: price, currency: 'USD', mcc: SAAS_OFFER.merchantCategoryCode, expect: 'APPROVED' },
  ]
  for (const c of cases) {
    let result: CardTransactionResult
    try {
      result = await api.simulateAuthorization({
        card_id: card.card_id,
        transaction_amount: c.amount,
        transaction_currency: c.currency,
        merchant_category_code: c.mcc,
        merchant_info: SAAS_OFFER.vendor,
        single_phase: true,
      })
    } catch (error) {
      // Keep going: the approval steps below don't depend on the simulator
      mismatches++
      console.log(`  ✗ ${c.label}: simulator error (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const outcome = result.process_result === 'APPROVED' ? 'APPROVED' : (result.failure_reason ?? 'DECLINED')
    const ok = outcome === c.expect
    if (!ok) mismatches++
    console.log(`  ${ok ? '✓' : '✗'} ${c.label}: ${outcome}${ok ? '' : ` (expected ${c.expect})`}`)
  }

  step('Price increase: a new approval updates the card')
  ctx.offers.framewise = { ...SAAS_OFFER, monthlyPrice: cents(690) }
  const update = await proposeCardUpdate(store, ctx, card.card_id, 'framewise')
  if (update.kind !== 'proposal') throw new Error(`Policy escalated: ${update.reason}`)
  await approve(store, ctx, update.proposal.id, update.proposal.fingerprint)
  const applied = await executor.execute(update.proposal.id)
  const updated = await api.getCard(card.card_id)
  const limits = updated.authorization_controls?.transaction_limits?.limits ?? []
  const limitsOk = limits.length === 2 && limits.every((l) => l.amount === 690)
  if (applied.status !== 'executed' || !limitsOk) mismatches++
  console.log(`  ${limitsOk ? '✓' : '✗'} update ${applied.status}; limits now ${JSON.stringify(limits)}`)

  step('Freeze proposal')
  const freeze = await proposeFreeze(store, ctx, card.card_id, 'Smoke test')
  await approve(store, ctx, freeze.id, freeze.fingerprint)
  await executor.execute(freeze.id)
  const frozen = await api.getCard(card.card_id)
  if (frozen.card_status !== 'INACTIVE') mismatches++
  console.log(`  ${frozen.card_status === 'INACTIVE' ? '✓' : '✗'} card ${frozen.card_status}`)

  console.log(mismatches === 0 ? '\nAll checks passed.' : `\n${mismatches} check(s) did not match.`)
  if (mismatches) process.exitCode = 1
}

run().catch((error) => {
  if (error instanceof AirwallexError) {
    console.error(`\n${error.message}`)
    console.error(JSON.stringify(error.details, null, 2))
  } else {
    console.error(error)
  }
  process.exitCode = 1
})
