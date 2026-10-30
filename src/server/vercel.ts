// Vercel entry (api/index.ts re-exports this). Every request opens a session over Redis: functions keep no disk.
// Missing configuration fails the function loudly instead of falling back to files or to an open API.
import { Redis } from '@upstash/redis'
import { airwallexApi } from '../airwallex/api.js'
import { AirwallexClient } from '../airwallex/client.js'
import { RedisProposalStore } from '../approvals/store.js'
import { openSession } from '../app/session.js'
import { RedisStateStore } from '../app/state.js'
import { createHandler } from './app.js'

function required(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  throw new Error(`Missing environment variable ${names.join(' or ')}`)
}

// The Upstash integration on Vercel sets either name pair depending on how it was added
const redis = new Redis({
  url: required('UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL'),
  token: required('UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN'),
})
// Module scope: a warm instance reuses the Airwallex token
const api = airwallexApi(AirwallexClient.fromEnv())

export const handler = createHandler(
  () => openSession({ api, store: new RedisProposalStore(redis), stateStore: new RedisStateStore(redis) }),
  { token: required('DEMO_TOKEN'), adminToken: process.env.ADMIN_TOKEN || undefined },
)
