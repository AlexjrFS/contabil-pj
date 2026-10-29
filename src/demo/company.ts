// Synthetic company for the demo. All data is fictional; the sandbox accepts synthetic data only.
// The numbers are pinned by test/policy.test.ts: annual saves 18% but breaks the reserve in week 7.
import type { CashPosition, SubscriptionOffer } from '../policy/cash.js'
import { cents } from '../policy/money.js'

export const COMPANY = {
  name: 'Halcyon',
  founder: { first_name: 'Alex', last_name: 'Sacramento', email: 'alex.founder@example.com' },
  description: 'a small Brazilian tech company that bills global clients and pays for its tools in USD',
}

export const AS_OF = '2026-11-02'

export const cashPosition = (): CashPosition => ({
  currency: 'USD',
  asOf: AS_OF,
  balance: cents(18_000),
  reserveFloor: cents(8_000),
  flows: [
    { date: '2026-11-06', amount: cents(4_500), label: 'Client retainer: André' },
    { date: '2026-11-13', amount: cents(-4_000), label: 'Contractor payroll' },
    { date: '2026-11-20', amount: cents(4_500), label: 'Client retainer: Danilo' },
    { date: '2026-11-27', amount: cents(-4_000), label: 'Contractor payroll' },
    { date: '2026-12-01', amount: cents(-1_500), label: 'Office rent' },
    { date: '2026-12-04', amount: cents(4_500), label: 'Client retainer: André' },
    { date: '2026-12-11', amount: cents(-4_000), label: 'Contractor payroll' },
    { date: '2026-12-15', amount: cents(-5_000), label: 'Quarterly tax payment' },
    { date: '2026-12-18', amount: cents(4_500), label: 'Client retainer: Danilo' },
    { date: '2026-12-24', amount: cents(-4_000), label: 'Contractor payroll' },
    { date: '2027-01-01', amount: cents(-1_500), label: 'Office rent' },
    { date: '2027-01-01', amount: cents(4_500), label: 'Client retainer: André' },
    { date: '2027-01-08', amount: cents(-4_000), label: 'Contractor payroll' },
    { date: '2027-01-15', amount: cents(4_500), label: 'Client retainer: Danilo' },
    { date: '2027-01-22', amount: cents(-4_000), label: 'Contractor payroll' },
  ],
})

// Monthly $600; annual = 12 × 600 × 0.82 = $5,904 (18% off)
export const SAAS_OFFER: SubscriptionOffer = {
  vendor: 'Framewise Inc.',
  product: 'Framewise Team',
  // 5734: computer software stores
  merchantCategoryCode: '5734',
  currency: 'USD',
  monthlyPrice: cents(600),
  annualPrice: cents(5_904),
  startDate: AS_OF,
}

// Offers the agent can refer to by id. It never passes prices: they come from here
export const OFFERS: Record<string, SubscriptionOffer> = { framewise: SAAS_OFFER }
