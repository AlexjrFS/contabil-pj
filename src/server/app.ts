// HTTP API for the app. Plain node:http: a handful of JSON routes plus a streamed chat.
// The app never sends amounts: charges are named scenarios and approvals echo the fingerprint they showed.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { AirwallexError } from '../airwallex/client.js'
import { ChatMessages, converse, type ChatEvent } from '../agent/chat.js'
import { ProposalError, type Proposal } from '../approvals/proposals.js'
import type { Session } from '../app/session.js'
import { formatUSD, type Cents } from '../policy/money.js'

export type Converse = typeof converse

const MAX_BODY = 64 * 1024

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

// Demo charges the card screen can trigger. Amounts come from the offer, never from the request
export const CHARGES = {
  monthly: (o) => ({ amount: o.monthlyPrice }),
  annual: (o) => ({ amount: o.annualPrice }),
  other_currency: (o) => ({ amount: o.monthlyPrice, currency: 'EUR' }),
  other_category: (o) => ({ amount: o.monthlyPrice, merchantCategoryCode: '5812' }),
} satisfies Record<
  string,
  (offer: { monthlyPrice: Cents; annualPrice: Cents }) => { amount: Cents; currency?: string; merchantCategoryCode?: string }
>

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'too_large', 'Request body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {}
  throw new HttpError(400, 'invalid_json', 'Body must be a JSON object')
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const describeProposal = (p: Proposal) => ({
  ...p,
  display: 'terms' in p.action ? { charge: formatUSD(p.action.terms.amount) } : null,
})

export function createApp(session: Session, options: { chat?: Converse } = {}) {
  const chat = options.chat ?? converse

  async function handleChat(req: IncomingMessage, res: ServerResponse) {
    const parsed = ChatMessages.safeParse((await readJson(req)).messages)
    if (!parsed.success) throw new HttpError(400, 'invalid_messages', parsed.error.issues[0]?.message ?? 'Invalid messages')
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' })
    const queue: Proposal[] = []
    const write = (event: ChatEvent) => res.write(`${JSON.stringify(event)}\n`)
    try {
      const events = chat(parsed.data, session.tools((p) => queue.push(p)), queue, {
        context: session.context(),
        signal: abort.signal,
      })
      for await (const event of events) write(event)
    } catch (error) {
      if (!abort.signal.aborted) write({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    res.end()
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const parts = url.pathname.split('/').filter(Boolean)
    const method = req.method ?? 'GET'
    const is = (m: string, ...path: string[]) =>
      method === m && parts.length === path.length && path.every((p, i) => p === '*' || p === parts[i])

    if (is('GET', 'health')) return send(res, 200, { ok: true })
    if (is('POST', 'chat')) return handleChat(req, res)

    if (is('GET', 'state')) {
      const offers = Object.entries(session.ctx.offers).map(([id, o]) => ({
        offer_id: id,
        vendor: o.vendor,
        product: o.product,
        monthly: formatUSD(o.monthlyPrice),
        annual: formatUSD(o.annualPrice),
      }))
      return send(res, 200, { ...session.state(), offers })
    }

    if (is('GET', 'proposals')) {
      const all = (await session.store.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      return send(res, 200, all.map(describeProposal))
    }
    if (is('POST', 'proposals', '*', 'approve')) {
      const { fingerprint } = await readJson(req)
      if (typeof fingerprint !== 'string') throw new HttpError(400, 'missing_fingerprint', 'fingerprint is required')
      return send(res, 200, describeProposal(await session.approve(parts[1]!, fingerprint)))
    }
    if (is('POST', 'proposals', '*', 'reject')) return send(res, 200, describeProposal(await session.reject(parts[1]!)))

    if (is('GET', 'cards', '*')) {
      const card = await session.card(parts[1]!)
      if (!card) throw new HttpError(404, 'no_card', `No card issued for ${parts[1]}`)
      return send(res, 200, card)
    }
    if (is('POST', 'invoices', '*', 'receive')) return send(res, 200, await session.receiveInvoice(parts[1]!))

    if (is('POST', 'charges')) {
      const { offer_id, kind } = await readJson(req)
      const offer = typeof offer_id === 'string' ? session.ctx.offers[offer_id] : undefined
      const build = typeof kind === 'string' ? CHARGES[kind as keyof typeof CHARGES] : undefined
      if (!offer || !build) throw new HttpError(400, 'invalid_charge', `offer_id and kind (${Object.keys(CHARGES).join(', ')}) are required`)
      if (!session.state().cards[offer_id as string]) throw new HttpError(404, 'no_card', `No card issued for ${offer_id}`)
      const charge = build(offer)
      const result = await session.simulateCharge(offer_id as string, charge)
      return send(res, 200, { kind, charge: { ...charge, display: formatUSD(charge.amount) }, result })
    }

    if (is('POST', 'demo', 'reset')) {
      await session.reset()
      return send(res, 200, session.state())
    }

    throw new HttpError(404, 'not_found', `${method} ${url.pathname}`)
  }

  return createServer(async (req, res) => {
    // The Expo web app runs on another port; this is a single-user local demo
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'content-type')
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end()
      return
    }
    try {
      await route(req, res)
    } catch (error) {
      if (res.headersSent) return void res.end()
      if (error instanceof HttpError) return send(res, error.status, { error: error.code, message: error.message })
      if (error instanceof ProposalError) {
        const status = error.code === 'not_found' ? 404 : 409
        return send(res, status, { error: error.code, message: error.message })
      }
      // Airwallex said no (e.g. the sandbox simulator error): pass its code through
      if (error instanceof AirwallexError) {
        return send(res, 502, { error: error.code, message: error.message, details: error.details })
      }
      console.error(error)
      send(res, 500, { error: 'internal', message: 'Something went wrong' })
    }
  })
}
