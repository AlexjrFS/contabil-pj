// Display only: amounts are computed by the API, the app just formats integer cents
export const formatCents = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)

// Airwallex limits come in major units
export const formatMajor = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)

export const MERCHANT_CATEGORIES: Record<string, string> = {
  '5734': 'Computer software stores',
  '5812': 'Restaurants',
}

export const describeCategory = (code: string) => (MERCHANT_CATEGORIES[code] ? `${code} · ${MERCHANT_CATEGORIES[code]}` : code)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 2026-11-06 → Nov 6 (dates are calendar days, no time zone)
export const formatDay = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`

export const formatDate = (iso: string) => `${formatDay(iso)}, ${iso.slice(0, 4)}`

// $18,000 for axis-like labels where cents add nothing
export const formatWhole = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
