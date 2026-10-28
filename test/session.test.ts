import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Card, CardholderStatus, SimulateAuthorizationInput } from '../src/airwallex/api.js'
import type { Proposal } from '../src/approvals/proposals.js'
import { JsonFileStore } from '../src/approvals/store.js'
import { openSession, type SessionApi } from '../src/app/session.js'
import { PRICE_INCREASE } from '../src/demo/invoices.js'
import { cents } from '../src/policy/money.js'

function fakeApi(cardholderStatus: CardholderStatus = 'READY') {
  const cards = new Map<string, Card>()
  const calls = { holders: 0, reviews: 0, creates: 0, updates: 0, simulations: [] as SimulateAuthorizationInput[] }
  let status = cardholderStatus
  const api: SessionApi = {
    async createIndividualCardholder() {
      calls.holders++
      return { cardholder_id: `holder-${calls.holders}`, status: 'PENDING', email: 'x@example.com' }
    },
    async getCardholder(id) {
      return { cardholder_id: id, status, email: 'x@example.com' }
    },
    async passCardholderReview() {
      calls.reviews++
      status = 'READY'
    },
    async createCard(input) {
      calls.creates++
      const card: Card = {
        card_id: `card-${calls.creates}`,
        card_status: 'ACTIVE',
        cardholder_id: input.cardholder_id,
        authorization_controls: input.authorization_controls,
        metadata: input.metadata,
      }
      cards.set(card.card_id, card)
      return card
    },
    async getCard(id) {
      return cards.get(id)!
    },
    async updateCard(id) {
      calls.updates++
      return cards.get(id)!
    },
    async listCards() {
      return { items: [...cards.values()], has_more: false }
    },
    async simulateAuthorization(input) {
      calls.simulations.push(input)
      return {
        card_transaction_id: 't',
        card_transaction_lifecycle_id: 'l',
        card_id: input.card_id,
        process_result: 'APPROVED',
        type: 'CLEARING',
        transaction_amount: input.transaction_amount,
        transaction_currency: input.transaction_currency,
      }
    },
  }
  return { api, calls }
}

async function withDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'contabil-pj-session-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const open = (dir: string, api: SessionApi) =>
  openSession({
    api,
    store: new JsonFileStore(join(dir, 'proposals.json')),
    statePath: join(dir, 'state.json'),
    sleep: async () => {},
  })

async function proposeVia(session: Awaited<ReturnType<typeof open>>, tool: string, input: Record<string, unknown>) {
  const proposals: Proposal[] = []
  const t = session.tools((p) => proposals.push(p)).find((x) => x.name === tool)!
  const result = JSON.parse((await t.run(input as never)) as string)
  return { result, proposal: proposals[0] }
}

test('the first session creates a READY cardholder once, using pass_review when needed', async () => {
  await withDir(async (dir) => {
    const { api, calls } = fakeApi('PENDING')
    await open(dir, api)
    await open(dir, api)
    assert.equal(calls.holders, 1)
    assert.equal(calls.reviews, 1)
  })
})

test('approving issues the card, records it, and the agent then sees it', async () => {
  await withDir(async (dir) => {
    const { api } = fakeApi()
    const session = await open(dir, api)
    assert.match(session.context(), /No cards have been issued yet/)

    const { proposal } = await proposeVia(session, 'propose_card', { offer_id: 'framewise' })
    const executed = await session.approve(proposal!.id, proposal!.fingerprint)
    assert.equal(executed.status, 'executed')
    assert.deepEqual(session.state().cards.framewise, { cardId: 'card-1', plan: 'monthly', proposalId: proposal!.id })
    assert.match(session.context(), /card-1, monthly plan/)

    const again = await proposeVia(session, 'propose_card', { offer_id: 'framewise' })
    assert.match(again.result.error, /already exists/)
    assert.equal(again.proposal, undefined)
  })
})

test('a restart keeps the card, the cardholder and the prices from received invoices', async () => {
  await withDir(async (dir) => {
    const { api, calls } = fakeApi()
    const first = await open(dir, api)
    const { proposal } = await proposeVia(first, 'propose_card', { offer_id: 'framewise' })
    await first.approve(proposal!.id, proposal!.fingerprint)
    assert.equal((await first.receiveInvoice(PRICE_INCREASE.id)).kind, 'updated')

    const second = await open(dir, api)
    assert.equal(calls.holders, 1)
    assert.equal(second.ctx.offers.framewise!.monthlyPrice, cents(690))
    const update = await proposeVia(second, 'propose_card_update', { card_id: 'card-1', offer_id: 'framewise' })
    assert.equal(update.result.terms.charge, '$690.00')
    assert.equal((await second.approve(update.proposal!.id, update.proposal!.fingerprint)).status, 'executed')
    assert.equal(calls.updates, 1)
  })
})

test('an update must target the card issued for that offer', async () => {
  await withDir(async (dir) => {
    const { api } = fakeApi()
    const session = await open(dir, api)
    const { proposal } = await proposeVia(session, 'propose_card', { offer_id: 'framewise' })
    await session.approve(proposal!.id, proposal!.fingerprint)
    const wrong = await proposeVia(session, 'propose_card_update', { card_id: 'card-999', offer_id: 'framewise' })
    assert.match(wrong.result.error, /not the card issued/)
    assert.equal(wrong.proposal, undefined)
  })
})

test('a simulated charge uses the card, the offer currency and category, in major units', async () => {
  await withDir(async (dir) => {
    const { api, calls } = fakeApi()
    const session = await open(dir, api)
    assert.throws(() => session.simulateCharge('framewise', { amount: cents(600) }), /No card/)
    const { proposal } = await proposeVia(session, 'propose_card', { offer_id: 'framewise' })
    await session.approve(proposal!.id, proposal!.fingerprint)
    await session.simulateCharge('framewise', { amount: cents(5_904) })
    assert.deepEqual(calls.simulations[0], {
      card_id: 'card-1',
      transaction_amount: 5904,
      transaction_currency: 'USD',
      merchant_category_code: '5734',
      merchant_info: 'Framewise Inc.',
      single_phase: true,
    })
  })
})

test('reset forgets proposals, cards and invoices but keeps the cardholder', async () => {
  await withDir(async (dir) => {
    const { api, calls } = fakeApi()
    const session = await open(dir, api)
    const { proposal } = await proposeVia(session, 'propose_card', { offer_id: 'framewise' })
    await session.approve(proposal!.id, proposal!.fingerprint)
    await session.receiveInvoice(PRICE_INCREASE.id)
    await session.reset()
    assert.deepEqual(session.state(), { cardholderId: 'holder-1', cards: {}, invoices: [] })
    assert.equal(session.ctx.offers.framewise!.monthlyPrice, cents(600))
    assert.deepEqual(await session.store.list(), [])
    await open(dir, api)
    assert.equal(calls.holders, 1)
  })
})
