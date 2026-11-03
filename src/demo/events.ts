// Cash news for the demo: a known flow moves. Code applies it to the cash position; the policy then re-plans
// on its own. The late retainer pushes even the monthly plan below the reserve, so the policy stops proposing
// and hands the decision to the founder (pinned by test/policy.test.ts).
import type { CashPosition } from '../policy/cash.js'

export interface CashEvent {
  id: string
  description: string
  // Flows that move to a new date, matched by date and label
  moves: { date: string; label: string; to: string }[]
}

export const LATE_RETAINER: CashEvent = {
  id: 'andre-late-2026-11',
  description: "André's November retainer is late: the client now pays on February 5",
  moves: [{ date: '2026-11-06', label: 'Client retainer: André', to: '2027-02-05' }],
}

export const CASH_EVENTS: Record<string, CashEvent> = { [LATE_RETAINER.id]: LATE_RETAINER }

export function applyCashEvents(position: CashPosition, events: CashEvent[]): CashPosition {
  let flows = position.flows
  for (const event of events) {
    for (const move of event.moves) {
      flows = flows.map((f) =>
        f.date === move.date && f.label === move.label ? { ...f, date: move.to, label: `${f.label} (late)` } : f,
      )
    }
  }
  return { ...position, flows }
}
