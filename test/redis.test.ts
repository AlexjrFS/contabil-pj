import assert from 'node:assert/strict'
import { test } from 'node:test'
import { proposeCard, type PolicyContext, type Proposal } from '../src/approvals/proposals.js'
import { RedisProposalStore, type RedisLike } from '../src/approvals/store.js'
import { RedisStateStore } from '../src/app/state.js'
import { cashPosition, OFFERS } from '../src/demo/company.js'

// Behaves like @upstash/redis: JSON-looking strings come back parsed
function fakeRedis(): RedisLike {
  const strings = new Map<string, string>()
  const hashes = new Map<string, Map<string, string>>()
  const parse = (v: string | undefined) => (v === undefined ? null : JSON.parse(v))
  return {
    async hset(key, values) {
      const hash = hashes.get(key) ?? new Map<string, string>()
      for (const [k, v] of Object.entries(values)) hash.set(k, String(v))
      hashes.set(key, hash)
      return Object.keys(values).length
    },
    async hget(key, field) {
      return parse(hashes.get(key)?.get(field))
    },
    async hvals(key) {
      return [...(hashes.get(key)?.values() ?? [])].map(parse)
    },
    async del(key) {
      return Number(hashes.delete(key) || strings.delete(key))
    },
    async get(key) {
      return parse(strings.get(key))
    },
    async set(key, value) {
      strings.set(key, String(value))
      return 'OK'
    },
  }
}

test('the Redis proposal store keeps each proposal in its own field', async () => {
  const store = new RedisProposalStore(fakeRedis())
  let n = 0
  const ctx: PolicyContext = { position: cashPosition, offers: { ...OFFERS }, newId: () => `p-${++n}` }
  const [a, b] = await Promise.all([proposeCard(store, ctx, 'framewise'), proposeCard(store, ctx, 'framewise')])
  const ids = [a, b].map((r) => (r as { proposal: Proposal }).proposal.id)
  assert.deepEqual((await store.list()).map((p) => p.id).sort(), ids.sort())
  assert.equal((await store.get('p-1'))?.status, 'pending')
  assert.equal(await store.get('missing'), undefined)
  await store.clear()
  assert.deepEqual(await store.list(), [])
})

test('the Redis state store starts empty and round-trips', async () => {
  const store = new RedisStateStore(fakeRedis())
  assert.deepEqual(await store.load(), { cards: {}, invoices: [] })
  const state = { cardholderId: 'h1', cards: { framewise: { cardId: 'c1', plan: 'monthly' as const, proposalId: 'p1' } }, invoices: ['inv'] }
  await store.save(state)
  assert.deepEqual(await store.load(), state)
})
