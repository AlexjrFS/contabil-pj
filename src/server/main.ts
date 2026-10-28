// npm run server: the API the app talks to. Binds 0.0.0.0 so a phone on the same Wi-Fi can reach it.
import { airwallexApi } from '../airwallex/api.js'
import { AirwallexClient } from '../airwallex/client.js'
import { JsonFileStore } from '../approvals/store.js'
import { openSession } from '../app/session.js'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3000)
const session = await openSession({ api: airwallexApi(AirwallexClient.fromEnv()), store: new JsonFileStore() })
createApp(session).listen(port, '0.0.0.0', () => {
  console.log(`Contabil PJ API on http://localhost:${port} (cardholder ${session.state().cardholderId})`)
})
