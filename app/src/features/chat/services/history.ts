// Conversations are kept on this device only (AsyncStorage), so they survive leaving the chat and restarting the
// app. The server never stores messages; proposals are re-read from it so a decision taken elsewhere shows here.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../../../api/client'
import type { Proposal } from '../../../api/types'

export type ChatItem =
  | { kind: 'message'; id: string; role: 'user' | 'assistant'; text: string }
  | { kind: 'proposal'; id: string; proposal: Proposal }
  | { kind: 'error'; id: string; text: string }

export interface Conversation {
  id: string
  // The first question, shortened
  title: string
  updatedAt: string
  items: ChatItem[]
}

export type ConversationSummary = Omit<Conversation, 'items'> & { messages: number }

const KEY = 'contabil-pj:conversations'
// The single thread saved by the previous version; moved into the list once
const LEGACY_KEY = 'contabil-pj:chat'

let counter = 0
// Unique across app restarts, so restored items never collide with new ones
export const newItemId = () => `${Date.now().toString(36)}-${++counter}`

const titleOf = (items: ChatItem[]) => {
  const first = items.find((i) => i.kind === 'message' && i.role === 'user')
  const text = first && first.kind === 'message' ? first.text.trim() : 'New conversation'
  return text.length > 60 ? `${text.slice(0, 57)}…` : text
}

async function readAll(): Promise<Conversation[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Conversation[]
    const legacy = await AsyncStorage.getItem(LEGACY_KEY)
    if (!legacy) return []
    const items = JSON.parse(legacy) as ChatItem[]
    const all = items.length ? [{ id: newItemId(), title: titleOf(items), updatedAt: new Date().toISOString(), items }] : []
    await AsyncStorage.setItem(KEY, JSON.stringify(all))
    await AsyncStorage.removeItem(LEGACY_KEY)
    return all
  } catch {
    return []
  }
}

async function writeAll(all: Conversation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(all))
  } catch {}
}

// Most recent first
export async function listConversations(): Promise<ConversationSummary[]> {
  return (await readAll())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ items, ...rest }) => ({ ...rest, messages: items.filter((i) => i.kind === 'message').length }))
}

// The conversation asked for, or else the most recent one; null when there is none
export async function loadConversation(id?: string): Promise<{ id: string; items: ChatItem[] } | null> {
  const all = await readAll()
  const found = id ? all.find((c) => c.id === id) : all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  if (!found) return null
  if (!found.items.some((i) => i.kind === 'proposal')) return { id: found.id, items: found.items }
  try {
    const current = new Map((await api.proposals()).map((p) => [p.id, p]))
    // A proposal missing on the server was cleared by a demo reset: drop it rather than offer a dead Approve
    const items = found.items.flatMap((i): ChatItem[] => {
      if (i.kind !== 'proposal') return [i]
      const proposal = current.get(i.proposal.id)
      return proposal ? [{ ...i, proposal }] : []
    })
    return { id: found.id, items }
  } catch {
    return { id: found.id, items: found.items }
  }
}

// Empty conversations are not kept
export async function saveConversation(id: string, items: ChatItem[]): Promise<void> {
  if (items.length === 0) return
  const all = (await readAll()).filter((c) => c.id !== id)
  all.push({ id, title: titleOf(items), updatedAt: new Date().toISOString(), items })
  await writeAll(all)
}

export async function deleteConversation(id: string): Promise<void> {
  await writeAll((await readAll()).filter((c) => c.id !== id))
}

// Demo reset: every conversation refers to proposals and cards that no longer exist
export async function clearConversations(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([KEY, LEGACY_KEY])
  } catch {}
}
