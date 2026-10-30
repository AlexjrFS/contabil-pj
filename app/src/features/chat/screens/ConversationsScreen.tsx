// Conversations saved on this device, most recent first: open one to continue it, or start a new one.
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useCallback, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import type { RootStackParamList } from '../../../navigation/RootNavigator'
import { useTheme } from '../../../theme/ThemeContext'
import { formatDay } from '../../../utils/format'
import { deleteConversation, listConversations, type ConversationSummary } from '../services/history'

const pad = (n: number) => String(n).padStart(2, '0')

// Local date and time: Oct 30 · 14:05
function formatWhen(iso: string) {
  const d = new Date(iso)
  return `${formatDay(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function ConversationsScreen() {
  const { colors } = useTheme()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)

  const load = useCallback(() => {
    listConversations().then(setConversations)
  }, [])

  useFocusEffect(load)

  // Back to the chat already open below, or a new one when coming from Home
  const open = (params: RootStackParamList['Chat']) => navigation.popTo('Chat', params)

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      data={conversations ?? []}
      keyExtractor={(c) => c.id}
      ListHeaderComponent={
        <Pressable
          accessibilityRole="button"
          onPress={() => open({ startNew: Date.now() })}
          style={[styles.newButton, { backgroundColor: colors.ink, borderColor: colors.gold }]}
        >
          <Text style={[styles.newText, { color: colors.onInk }]}>New conversation</Text>
          <Text style={[styles.arrow, { color: colors.gold }]}>→</Text>
        </Pressable>
      }
      ListEmptyComponent={
        conversations ? (
          <Text style={[styles.empty, { color: colors.muted }]}>No conversations yet. They are kept on this phone only.</Text>
        ) : undefined
      }
      ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: colors.border }]} />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <Pressable accessibilityRole="button" onPress={() => open({ id: item.id })} style={styles.main}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.meta, { color: colors.muted }]}>
              {formatWhen(item.updatedAt)} · {item.messages} {item.messages === 1 ? 'message' : 'messages'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${item.title}`}
            onPress={() => deleteConversation(item.id).then(load)}
            hitSlop={10}
          >
            <Text style={[styles.delete, { color: colors.muted }]}>Delete</Text>
          </Pressable>
        </View>
      )}
    />
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 0 },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  newText: { fontSize: 15, fontWeight: '700' },
  arrow: { fontSize: 22, fontWeight: '300' },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 14 },
  separator: { height: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  main: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  meta: { fontSize: 12, fontVariant: ['tabular-nums'] },
  delete: { fontSize: 13 },
})
