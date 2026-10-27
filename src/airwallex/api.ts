// Typed wrappers for the Airwallex endpoints Kit 02 needs. Field names follow the API reference.
import type { AirwallexClient } from './client.js'

export type Interval = 'PER_TRANSACTION' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ALL_TIME'

export interface Limit {
  amount: number
  interval: Interval
}

export interface AuthorizationControls {
  allowed_transaction_count: 'SINGLE' | 'MULTIPLE'
  transaction_limits: { currency?: string; limits: Limit[]; cash_withdrawal_limits?: Limit[] }
  allowed_currencies?: string[]
  allowed_merchant_categories?: string[]
  active_from?: string
  active_to?: string
}

export type CardStatus = 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'LOST' | 'STOLEN' | 'CLOSED' | 'FAILED'

export interface Card {
  card_id: string
  card_status: CardStatus
  cardholder_id: string
  nick_name?: string
  authorization_controls?: AuthorizationControls
  metadata?: Record<string, string>
}

export interface CreateCardInput {
  request_id: string
  cardholder_id: string
  created_by: string
  form_factor: 'VIRTUAL'
  is_personalized: boolean
  program: { purpose: 'COMMERCIAL' | 'CONSUMER'; type?: 'PREPAID' | 'DEBIT' | 'CREDIT' | 'DEFERRED_DEBIT' }
  authorization_controls: AuthorizationControls
  purpose?:
    | 'BUSINESS_EXPENSES'
    | 'ONLINE_PURCHASING'
    | 'SUBSCRIPTIONS'
    | 'OTHER'
  nick_name?: string
  note?: string
  metadata?: Record<string, string>
}

// On update, send the full controls object: omitted merchant categories default to [] and
// transaction_limits needs both limits and cash_withdrawal_limits
export interface UpdateCardInput {
  card_status?: 'ACTIVE' | 'INACTIVE' | 'CLOSED'
  authorization_controls?: Omit<AuthorizationControls, 'allowed_transaction_count'> & {
    transaction_limits: { currency?: string; limits: Limit[]; cash_withdrawal_limits: Limit[] }
  }
  nick_name?: string
  metadata?: Record<string, string>
}

export type CardholderStatus = 'INCOMPLETE' | 'PENDING' | 'READY' | 'DISABLED' | 'DELETED'

export interface Cardholder {
  cardholder_id: string
  status: CardholderStatus
  email: string
}

export interface IndividualCardholderInput {
  email: string
  first_name: string
  last_name: string
  date_of_birth: string
  address: { line1: string; city: string; postcode: string; country: string; state?: string }
}

export interface Balance {
  currency: string
  available_amount: number
  pending_amount: number
  reserved_amount: number
  total_amount: number
}

export interface GlobalAccount {
  id: string
  status: string
}

export interface Deposit {
  id: string
  amount: number
  currency: string
  status: 'PENDING' | 'REJECTED' | 'SETTLED'
}

export type SimulationFailure =
  | 'CARDHOLDER_VERIFICATION_FAILED'
  | 'CVV_INVALID'
  | 'INVALID_EXPIRY_DATE'
  | 'PIN_INVALID'
  | 'PIN_RETRIES_EXCEEDED'
  | 'TRANSACTION_BLOCKED'

export interface SimulateAuthorizationInput {
  card_id: string
  transaction_amount: number
  transaction_currency: string
  merchant_category_code?: string
  merchant_info?: string
  single_phase?: boolean
  transaction_failure_reason?: SimulationFailure
}

export interface CardTransactionResult {
  card_transaction_id: string
  card_transaction_lifecycle_id: string
  card_id: string
  process_result: 'APPROVED' | 'DECLINED'
  // Present only when declined (LIMIT_EXCEEDED, CURRENCY_NOT_ALLOWED, MERCHANT_CATEGORY_NOT_ALLOWED, ...)
  failure_reason?: string
  type: 'AUTHORIZATION' | 'CLEARING' | 'REVERSAL_AUTH'
  subtype?: string
  transaction_amount: number
  transaction_currency: string
  merchant?: { category_code?: string; name?: string }
}

export interface Page<T> {
  items: T[]
  has_more?: boolean
}

export function airwallexApi(client: AirwallexClient) {
  return {
    balances: () => client.get<Balance[]>('/api/v1/balances/current'),

    createGlobalAccount: (input: { request_id: string; country_code: string; currency: string; nick_name?: string }) =>
      client.post<GlobalAccount>('/api/v1/global_accounts/create', {
        request_id: input.request_id,
        country_code: input.country_code,
        nick_name: input.nick_name,
        required_features: [{ currency: input.currency, transfer_method: 'LOCAL' }],
      }),

    // Posts immediately even when the response says PENDING: re-read balances afterwards
    simulateDeposit: (input: { global_account_id: string; amount: number; payer_name?: string; reference?: string }) =>
      client.post<Deposit>('/api/v1/simulation/deposit/create', input),

    createIndividualCardholder: (input: IndividualCardholderInput) =>
      client.post<Cardholder>('/api/v1/issuing/cardholders/create', {
        type: 'INDIVIDUAL',
        email: input.email,
        individual: {
          name: { first_name: input.first_name, last_name: input.last_name },
          date_of_birth: input.date_of_birth,
          express_consent_obtained: 'yes',
          address: input.address,
        },
      }),

    getCardholder: (id: string) => client.get<Cardholder>(`/api/v1/issuing/cardholders/${encodeURIComponent(id)}`),

    // Fallback when a sandbox cardholder stays PENDING
    passCardholderReview: (id: string) =>
      client.post<unknown>(`/api/v1/simulation/issuing/cardholders/${encodeURIComponent(id)}/pass_review`),

    createCard: (input: CreateCardInput) => client.post<Card>('/api/v1/issuing/cards/create', input),

    getCard: (id: string) => client.get<Card>(`/api/v1/issuing/cards/${encodeURIComponent(id)}`),

    // List items carry no metadata: read each card to see it
    listCards: (query: { cardholder_id?: string; card_status?: CardStatus; page_num?: number; page_size?: number } = {}) =>
      client.get<Page<Card>>('/api/v1/issuing/cards', { query }),

    updateCard: (id: string, input: UpdateCardInput) =>
      client.post<Card>(`/api/v1/issuing/cards/${encodeURIComponent(id)}/update`, input),

    // Returns process_result and failure_reason synchronously: no polling needed for the demo
    simulateAuthorization: (input: SimulateAuthorizationInput) =>
      client.post<CardTransactionResult>('/api/v1/simulation/issuing/create', input, { versioned: true }),

    captureLifecycle: (lifecycleId: string, input: { transaction_amount?: number } = {}) =>
      client.post<CardTransactionResult>(
        `/api/v1/simulation/issuing/card_transaction_lifecycles/${encodeURIComponent(lifecycleId)}/capture`,
        input,
      ),

    reverseLifecycle: (lifecycleId: string, input: { transaction_amount?: number } = {}) =>
      client.post<CardTransactionResult>(
        `/api/v1/simulation/issuing/card_transaction_lifecycles/${encodeURIComponent(lifecycleId)}/reverse`,
        input,
      ),

    listTransactions: (query: { card_id?: string; page_num?: number; page_size?: number } = {}) =>
      client.get<Page<Record<string, unknown>>>('/api/v1/issuing/transactions', { query }),
  }
}

export type AirwallexApi = ReturnType<typeof airwallexApi>
