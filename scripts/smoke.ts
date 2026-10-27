// End-to-end check against the Airwallex sandbox: funding → cardholder → decision → card → authorizations.
// Run with `npm run smoke` after filling .env. Every step prints what it did; nothing here touches real money.
import { randomUUID } from 'node:crypto'
import { airwallexApi, type CardTransactionResult } from '../src/airwallex/api.js'
import { AirwallexClient, AirwallexError } from '../src/airwallex/client.js'
import { cashPosition, COMPANY, SAAS_OFFER } from '../src/demo/company.js'
import { cardRequest, cardUpdate } from '../src/policy/card.js'
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

  step('Issuing the virtual card that enforces the decision')
  const decision = { id: randomUUID(), plan: rec.plan, offer: SAAS_OFFER, revisitOn: rec.revisitOn }
  const created = await api.createCard(cardRequest(decision, holderId, `${COMPANY.founder.first_name} ${COMPANY.founder.last_name}`))
  const card = await waitFor(() => api.getCard(created.card_id), (c) => c.card_status === 'ACTIVE')
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
  let mismatches = 0
  for (const c of cases) {
    const result: CardTransactionResult = await api.simulateAuthorization({
      card_id: card.card_id,
      transaction_amount: c.amount,
      transaction_currency: c.currency,
      merchant_category_code: c.mcc,
      merchant_info: SAAS_OFFER.vendor,
      single_phase: true,
    })
    const outcome = result.process_result === 'APPROVED' ? 'APPROVED' : (result.failure_reason ?? 'DECLINED')
    const ok = outcome === c.expect
    if (!ok) mismatches++
    console.log(`  ${ok ? '✓' : '✗'} ${c.label}: ${outcome}${ok ? '' : ` (expected ${c.expect})`}`)
  }

  step('Price increase: re-plan and update the card controls')
  const raised = { ...SAAS_OFFER, monthlyPrice: cents(690) }
  await api.updateCard(card.card_id, cardUpdate(raised, 'monthly'))
  const updated = await api.getCard(card.card_id)
  console.log(`  limits now: ${JSON.stringify(updated.authorization_controls?.transaction_limits?.limits)}`)

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
