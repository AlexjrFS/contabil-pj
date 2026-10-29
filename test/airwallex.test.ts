import assert from 'node:assert/strict'
import { test } from 'node:test'
import { airwallexApi } from '../src/airwallex/api.js'
import { AirwallexClient, AirwallexError } from '../src/airwallex/client.js'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

// Fake fetch: answers login, then hands each request to the handler
function fakeAirwallex(handler: (call: Call, n: number) => { status: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = []
  let logins = 0
  let n = 0
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    calls.push(call)
    if (call.url.endsWith('/api/v1/authentication/login')) {
      logins++
      return new Response(JSON.stringify({ token: `token-${logins}`, expires_at: '2026-10-27T12:30:00Z' }), {
        status: 201,
      })
    }
    const r = handler(call, n++)
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: r.headers })
  }) as typeof fetch
  return { calls, fetchFn, logins: () => logins }
}

const NOW = Date.parse('2026-10-27T12:00:00Z')
const client = (fetchFn: typeof fetch, extra = {}) =>
  new AirwallexClient({
    clientId: 'id',
    apiKey: 'key',
    apiVersion: '2026-08-21',
    fetch: fetchFn,
    now: () => NOW,
    sleep: async () => {},
    ...extra,
  })

test('logs in once and reuses the token until it is about to expire', async () => {
  let now = NOW
  const fake = fakeAirwallex(() => ({ status: 200, body: [] }))
  const api = airwallexApi(client(fake.fetchFn, { now: () => now }))
  await api.balances()
  await api.balances()
  assert.equal(fake.logins(), 1)
  const login = fake.calls[0]!
  assert.equal(login.headers['x-client-id'], 'id')
  assert.equal(login.headers['x-api-key'], 'key')
  assert.equal(fake.calls[1]!.headers.Authorization, 'Bearer token-1')

  // Inside the one-minute safety margin: log in again
  now = Date.parse('2026-10-27T12:29:30Z')
  await api.balances()
  assert.equal(fake.logins(), 2)
})

test('concurrent first calls share a single login', async () => {
  const fake = fakeAirwallex(() => ({ status: 200, body: [] }))
  const api = airwallexApi(client(fake.fetchFn))
  await Promise.all([api.balances(), api.balances(), api.balances()])
  assert.equal(fake.logins(), 1)
})

test('sends x-api-version only on calls that opt in', async () => {
  const fake = fakeAirwallex(() => ({ status: 201, body: { process_result: 'APPROVED' } }))
  const api = airwallexApi(client(fake.fetchFn))
  await api.simulateAuthorization({ card_id: 'c1', transaction_amount: 600, transaction_currency: 'USD' })
  await api.balances()
  const [, simulation, balances] = fake.calls
  assert.equal(simulation!.headers['x-api-version'], '2026-08-21')
  assert.equal(balances!.headers['x-api-version'], undefined)
})

test('retries on 429 and then succeeds', async () => {
  const fake = fakeAirwallex((_, n) => (n < 2 ? { status: 429, headers: { 'retry-after': '1' } } : { status: 200, body: [] }))
  const delays: number[] = []
  const api = airwallexApi(client(fake.fetchFn, { sleep: async (ms: number) => void delays.push(ms) }))
  await api.balances()
  assert.deepEqual(delays, [1000, 1000])
})

test('logs in again once when a token is rejected', async () => {
  const fake = fakeAirwallex((call) =>
    call.headers.Authorization === 'Bearer token-1'
      ? { status: 401, body: { code: 'credentials_expired', message: 'expired' } }
      : { status: 200, body: [] },
  )
  await airwallexApi(client(fake.fetchFn)).balances()
  assert.equal(fake.logins(), 2)
})

test('turns API errors into AirwallexError with the code', async () => {
  const fake = fakeAirwallex(() => ({ status: 400, body: { code: 'duplicate_request_id', message: 'already used' } }))
  await assert.rejects(airwallexApi(client(fake.fetchFn)).balances(), (e: unknown) => {
    assert.ok(e instanceof AirwallexError)
    assert.equal(e.status, 400)
    assert.equal(e.code, 'duplicate_request_id')
    return true
  })
})

test('caps concurrent requests', async () => {
  let inFlight = 0
  let peak = 0
  const fetchFn = (async (input: string | URL | Request) => {
    if (String(input).endsWith('/login')) {
      return new Response(JSON.stringify({ token: 't', expires_at: '2026-10-27T12:30:00Z' }), { status: 201 })
    }
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((r) => setTimeout(r, 5))
    inFlight--
    return new Response('[]', { status: 200 })
  }) as typeof fetch
  const api = airwallexApi(client(fetchFn, { maxConcurrent: 2 }))
  await Promise.all(Array.from({ length: 6 }, () => api.balances()))
  assert.equal(peak, 2)
})

test('capture and reverse use the lifecycle path', async () => {
  const fake = fakeAirwallex(() => ({ status: 200, body: {} }))
  const api = airwallexApi(client(fake.fetchFn))
  await api.captureLifecycle('life-1')
  await api.reverseLifecycle('life-1', { transaction_amount: 10 })
  assert.ok(fake.calls[1]!.url.endsWith('/api/v1/simulation/issuing/card_transaction_lifecycles/life-1/capture'))
  assert.ok(fake.calls[2]!.url.endsWith('/api/v1/simulation/issuing/card_transaction_lifecycles/life-1/reverse'))
  assert.deepEqual(fake.calls[2]!.body, { transaction_amount: 10 })
})

test('cardholder create sends the REST shape with consent', async () => {
  const fake = fakeAirwallex(() => ({ status: 202, body: { cardholder_id: 'h1', status: 'PENDING' } }))
  await airwallexApi(client(fake.fetchFn)).createIndividualCardholder({
    email: 'a@example.com',
    first_name: 'Alex',
    last_name: 'Sacramento',
    date_of_birth: '1990-01-01',
    address: { line1: '1 Main St', city: 'San Francisco', postcode: '94105', country: 'US', state: 'CA' },
  })
  const body = fake.calls[1]!.body as any
  assert.equal(body.type, 'INDIVIDUAL')
  assert.equal(body.individual.express_consent_obtained, 'yes')
  assert.deepEqual(body.individual.name, { first_name: 'Alex', last_name: 'Sacramento' })
})
