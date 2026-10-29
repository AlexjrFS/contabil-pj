// The conversation is kept on this device only (AsyncStorage), so it survives leaving the chat and restarting the
// app. The server never stores messages; proposals are re-read from it so a decision taken elsewhere shows here.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { api } from '../../../api/client'
import type { Proposal } from '../../../api/types'

export type ChatItem =
  | { kind: 'message'; id: string; role: 'user' | 'assistant'; text: string }
  | { kind: 'proposal'; id: string; proposal: Proposal }
  | { kind: 'error'; id: string; text: string }

const KEY = 'contabil-pj:chat'

let counter = 0
// Unique across app restarts, so restored items never collide with new ones
export const newItemId = () => `${Date.now().toString(36)}-${++counter}`

export async function loadChat(): Promise<ChatItem[]> {
  let items: ChatItem[] = []
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (raw) items = JSON.parse(raw) as ChatItem[]
  } catch {
    return []
  }
  if (!items.some((i) => i.kind === 'proposal')) return items
  try {
    const current = new Map((await api.proposals()).map((p) => [p.id, p]))
    // A proposal missing on the server was cleared by a demo reset: drop it rather than offer a dead Approve
    return items.flatMap((i): ChatItem[] => {
      if (i.kind !== 'proposal') return [i]
      const proposal = current.get(i.proposal.id)
      return proposal ? [{ ...i, proposal }] : []
    })
  } catch {
    return items
  }
}

export async function saveChat(items: ChatItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(items))
  } catch {}
}

export async function clearChat(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY)
  } catch {}
}
