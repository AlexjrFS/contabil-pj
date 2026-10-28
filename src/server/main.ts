// npm run server: the API locally, with state in data/. Binds 0.0.0.0 so a phone on the same Wi-Fi can reach it.
import { createServer } from 'node:http'
import { airwallexApi } from '../airwallex/api.js'
import { AirwallexClient } from '../airwallex/client.js'
import { JsonFileStore } from '../approvals/store.js'
import { openSession } from '../app/session.js'
import { createHandler, toNodeListener } from './app.js'

const port = Number(process.env.PORT ?? 3000)
const session = await openSession({ api: airwallexApi(AirwallexClient.fromEnv()), store: new JsonFileStore() })
const handler = createHandler(async () => session, { token: process.env.DEMO_TOKEN || undefined })
createServer(toNodeListener(handler)).listen(port, '0.0.0.0', () => {
  console.log(`Contabil PJ API on http://localhost:${port}${process.env.DEMO_TOKEN ? ' (demo token required)' : ''}`)
})
