// Talk to the agent from the terminal: npm run chat -- "Should we buy Framewise annual or monthly?"
// Add --after-invoice to play the moment the December price-increase invoice arrives.
// Proposals are printed with their fingerprint; nothing is approved or executed here.
import { airwallexApi } from '../src/airwallex/api.js'
import { AirwallexClient } from '../src/airwallex/client.js'
import { converse } from '../src/agent/chat.js'
import { agentTools } from '../src/agent/tools.js'
import { ingestInvoice } from '../src/approvals/invoices.js'
import type { PolicyContext, Proposal } from '../src/approvals/proposals.js'
import { JsonFileStore } from '../src/approvals/store.js'
import { AS_OF, cashPosition, OFFERS } from '../src/demo/company.js'
import { INVOICES, PRICE_INCREASE } from '../src/demo/invoices.js'

const args = process.argv.slice(2)
const afterInvoice = args.includes('--after-invoice')
const text = args.filter((a) => a !== '--after-invoice').join(' ').trim()
if (!text) {
  console.error('Usage: npm run chat -- [--after-invoice] "your message"')
  process.exit(1)
}

const ctx: PolicyContext = { position: cashPosition, offers: { ...OFFERS } }
if (afterInvoice) console.log(`(invoice arrived: ${JSON.stringify(ingestInvoice(ctx, 'framewise', PRICE_INCREASE).kind)})\n`)

const queue: Proposal[] = []
const tools = agentTools({
  store: new JsonFileStore(),
  ctx,
  invoices: INVOICES,
  cards: airwallexApi(AirwallexClient.fromEnv()),
  onProposal: (p) => queue.push(p),
})

for await (const event of converse([{ role: 'user', text }], tools, queue, { asOf: AS_OF })) {
  if (event.type === 'text') process.stdout.write(event.text)
  else if (event.type === 'tool') process.stdout.write(`\n[${event.name}]\n`)
  else if (event.type === 'proposal') {
    const { id, action, fingerprint } = event.proposal
    console.log(`\n[proposal ${id}] ${JSON.stringify(action)}\n  fingerprint ${fingerprint}`)
  } else if (event.type === 'error') console.error(`\n[error] ${event.message}`)
  else console.log()
}
