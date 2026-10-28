// One demo session: the shared policy context, proposals, executor and the scenario state (cardholder, cards
// issued, invoices received). The server and the CLI both go through here, so the agent's tools and the
// executor always see the same offers. State lives in data/ and survives a restart mid-rehearsal.
import { readFile } from 'node:fs/promises'
import type { AirwallexApi, CardTransactionResult } from '../airwallex/api.js'
import { conversationContext } from '../agent/prompt.js'
import { agentTools } from '../agent/tools.js'
import { createExecutor } from '../approvals/executor.js'
import { ingestInvoice, type IngestResult } from '../approvals/invoices.js'
import {
  approve,
  reject,
  type PolicyContext,
  type Proposal,
  type ProposalStore,
} from '../approvals/proposals.js'
import { writeJsonAtomic } from '../approvals/store.js'
import { AS_OF, cashPosition, COMPANY, OFFERS } from '../demo/company.js'
import { INVOICES, type Invoice } from '../demo/invoices.js'
import type { Plan } from '../policy/cash.js'
import { toMajor, type Cents } from '../policy/money.js'

export interface IssuedCard {
  cardId: string
  plan: Plan
  proposalId: string
}

export interface DemoState {
  cardholderId?: string
  // By offer id
  cards: Record<string, IssuedCard>
  // Invoice ids in the order they arrived
  invoices: string[]
}

export type SessionApi = Pick<
  AirwallexApi,
  | 'createCard'
  | 'getCard'
  | 'updateCard'
  | 'listCards'
  | 'createIndividualCardholder'
  | 'getCardholder'
  | 'passCardholderReview'
  | 'simulateAuthorization'
>

export interface SessionDeps {
  api: SessionApi
  store: ProposalStore
  statePath?: string
  invoices?: Record<string, Invoice>
  now?: () => Date
  newId?: () => string
  sleep?: (ms: number) => Promise<void>
}

const emptyState = (cardholderId?: string): DemoState => ({ cardholderId, cards: {}, invoices: [] })

async function loadState(path: string): Promise<DemoState> {
  try {
    return { ...emptyState(), ...(JSON.parse(await readFile(path, 'utf8')) as DemoState) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState()
    throw error
  }
}

// The offer an invoice belongs to: same vendor. ingestInvoice then checks category and currency
const offerIdFor = (ctx: PolicyContext, invoice: Invoice) =>
  Object.entries(ctx.offers).find(([, offer]) => offer.vendor === invoice.vendor)?.[0]

// Sandbox cardholders usually turn READY on their own; pass_review is the documented fallback
export async function createReadyCardholder(api: SessionApi, sleep: (ms: number) => Promise<void>): Promise<string> {
  const created = await api.createIndividualCardholder({
    email: `founder+${Date.now()}@example.com`,
    first_name: COMPANY.founder.first_name,
    last_name: COMPANY.founder.last_name,
    date_of_birth: '1990-05-14',
    address: { line1: '500 Howard St', city: 'San Francisco', state: 'CA', postcode: '94105', country: 'US' },
  })
  const waitReady = async () => {
    for (let i = 0; i < 10; i++) {
      if ((await api.getCardholder(created.cardholder_id)).status === 'READY') return true
      await sleep(2_000)
    }
    return false
  }
  if (!(await waitReady())) {
    await api.passCardholderReview(created.cardholder_id)
    if (!(await waitReady())) throw new Error(`Cardholder ${created.cardholder_id} never became READY`)
  }
  return created.cardholder_id
}

export async function openSession(deps: SessionDeps) {
  const { api, store } = deps
  const statePath = deps.statePath ?? 'data/state.json'
  const invoices = deps.invoices ?? INVOICES
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const state = await loadState(statePath)
  const save = () => writeJsonAtomic(statePath, state)

  const ctx: PolicyContext = { position: cashPosition, offers: { ...OFFERS }, now: deps.now, newId: deps.newId }
  // Replay the invoices already received so a restart keeps the current prices
  for (const id of state.invoices) {
    const invoice = invoices[id]
    const offerId = invoice && offerIdFor(ctx, invoice)
    if (invoice && offerId) ingestInvoice(ctx, offerId, invoice)
  }

  if (!state.cardholderId) {
    state.cardholderId = await createReadyCardholder(api, sleep)
    await save()
  }
  const executor = createExecutor({
    store,
    cards: api,
    ctx,
    cardholderId: state.cardholderId,
    createdBy: `${COMPANY.founder.first_name} ${COMPANY.founder.last_name}`,
  })

  async function record(proposal: Proposal) {
    const { action } = proposal
    if (proposal.status !== 'executed' || action.kind === 'freeze_card') return
    if (action.kind === 'issue_card') {
      state.cards[action.offerId] = { cardId: proposal.result!.cardId, plan: action.terms.plan, proposalId: proposal.id }
    } else {
      const card = state.cards[action.offerId]
      if (card) card.plan = action.terms.plan
    }
    await save()
  }

  return {
    ctx,
    store,
    state: () => structuredClone(state),

    tools: (onProposal: (p: Proposal) => void) =>
      agentTools({ store, ctx, invoices, cards: api, onProposal, cardFor: (offerId) => state.cards[offerId] }),

    context: () =>
      conversationContext(
        AS_OF,
        Object.entries(state.cards).map(([offerId, card]) => ({ offerId, vendor: ctx.offers[offerId]?.vendor, ...card })),
      ),

    // The founder's tap on "Approve": approval and execution in one step
    async approve(id: string, fingerprint: string): Promise<Proposal> {
      await approve(store, ctx, id, fingerprint)
      const proposal = await executor.execute(id)
      await record(proposal)
      return proposal
    },

    reject: (id: string) => reject(store, ctx, id),

    // A supplier invoice arrives: prices change in code; cards keep the old limits until a new approval
    async receiveInvoice(invoiceId: string): Promise<IngestResult> {
      const invoice = invoices[invoiceId]
      if (!invoice) return { kind: 'refused', reason: 'unknown_offer' }
      const offerId = offerIdFor(ctx, invoice)
      if (!offerId) return { kind: 'refused', reason: 'vendor_mismatch' }
      const result = ingestInvoice(ctx, offerId, invoice)
      if (result.kind === 'updated') {
        state.invoices.push(invoiceId)
        await save()
      }
      return result
    },

    async card(offerId: string) {
      const issued = state.cards[offerId]
      return issued ? { ...issued, card: await api.getCard(issued.cardId) } : null
    },

    // A charge at the vendor, as the card network would send it. Amounts in cents, like everywhere else
    simulateCharge(
      offerId: string,
      charge: { amount: Cents; currency?: string; merchantCategoryCode?: string },
    ): Promise<CardTransactionResult> {
      const issued = state.cards[offerId]
      const offer = ctx.offers[offerId]
      if (!issued || !offer) throw new Error(`No card for offer ${offerId}`)
      return api.simulateAuthorization({
        card_id: issued.cardId,
        transaction_amount: toMajor(charge.amount),
        transaction_currency: charge.currency ?? offer.currency,
        merchant_category_code: charge.merchantCategoryCode ?? offer.merchantCategoryCode,
        merchant_info: offer.vendor,
        single_phase: true,
      })
    },

    // Between takes of the video: forget proposals, cards and invoices; keep the cardholder
    async reset() {
      await store.clear()
      Object.assign(state, emptyState(state.cardholderId))
      ctx.offers = { ...OFFERS }
      await save()
    },
  }
}

export type Session = Awaited<ReturnType<typeof openSession>>
