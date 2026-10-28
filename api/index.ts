// Every API path is rewritten here (vercel.json); the router in src/server/app.ts reads the original path.
import { handler } from '../src/server/vercel.js'

// The chat runs a few model turns plus Airwallex calls; the invoice scene takes about 12 s
export const maxDuration = 60

export const GET = handler
export const POST = handler
export const OPTIONS = handler
