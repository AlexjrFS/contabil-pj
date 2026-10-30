// The first screen: the company's cash, the next 12 weeks against the reserve, the card Airwallex enforces, and
// anything waiting for the founder's approval. The agent is one entry at the bottom, not the whole app.
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { Text } from '../../../components/Text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, ApiError } from '../../../api/client'
import type { CardView, CashView, Proposal } from '../../../api/types'
import type { RootStackParamList } from '../../../navigation/RootNavigator'
import { displayFont, useTheme } from '../../../theme/ThemeContext'
import { formatCents, formatDate, formatDay } from '../../../utils/format'
import { ProposalCard } from '../../chat/components/ProposalCard'
import { RunwayChart } from '../components/RunwayChart'
import { VirtualCard } from '../components/VirtualCard'

const OFFER = 'framewise'

export function HomeScreen() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [cash, setCash] = useState<CashView | null>(null)
  const [card, setCard] = useState<CardView | null>(null)
  const [pending, setPending] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [cashResult, cardResult, proposalsResult] = await Promise.allSettled([api.cash(), api.card(OFFER), api.proposals()])
    if (cashResult.status === 'fulfilled') {
      setCash(cashResult.value)
      setError(null)
    } else {
      const e = cashResult.reason
      setError(e instanceof ApiError && e.status === 401 ? 'The demo token is wrong. Check Settings.' : 'Could not reach the server. Check Settings.')
    }
    // 404 no_card is the normal state before the first approval
    setCard(cardResult.status === 'fulfilled' ? cardResult.value : null)
    if (proposalsResult.status === 'fulfilled') {
      const now = Date.now()
      setPending(proposalsResult.value.filter((p) => p.status === 'pending' && Date.parse(p.expiresAt) > now))
    }
    setLoading(false)
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const lowest = cash?.weeks.reduce((min, w) => (w.lowest < min.lowest ? w : min), cash.weeks[0]!)

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}
        refreshControl={<RefreshControl refreshing={loading && cash !== null} onRefresh={load} tintColor={colors.primary} />}
      >
        <View style={styles.top}>
          <View style={styles.brand}>
            <Image source={require('../../../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
            <View>
              <Text style={[styles.company, { color: colors.text }]}>Halcyon</Text>
              <Text style={[styles.product, { color: colors.muted }]}>Contabil PJ</Text>
            </View>
          </View>
          <View style={styles.topLinks}>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Conversations')} hitSlop={10}>
              <Text style={[styles.topLink, { color: colors.primary }]}>History</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Settings')} hitSlop={10}>
              <Text style={[styles.topLink, { color: colors.primary }]}>Settings</Text>
            </Pressable>
          </View>
        </View>

        {!cash && loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : null}
        {error && !cash ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        {cash ? (
          <>
            <View style={styles.hero}>
              <Text style={[styles.label, { color: colors.muted }]}>OPERATING CASH · {cash.currency}</Text>
              <Text style={[styles.balance, { color: colors.text }]} adjustsFontSizeToFit numberOfLines={1}>
                {formatCents(cash.balance, cash.currency)}
              </Text>
              <Text style={[styles.asOf, { color: colors.muted }]}>As of {formatDate(cash.asOf)} · simulated cash for a demo company</Text>
            </View>

            <View style={[styles.split, { borderColor: colors.border }]}>
              <Stat label="Reserve floor" value={formatCents(cash.reserveFloor, cash.currency)} note="Never spent" />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Stat
                label="Lowest ahead"
                value={lowest ? formatCents(lowest.lowest, cash.currency) : '—'}
                note={lowest ? `Week ${lowest.week} · ${formatDay(lowest.start)}` : ''}
                danger={lowest?.breach}
              />
            </View>

            <Section title="Next 12 weeks" caption="Lowest balance each week, counting what the card already commits." />
            <RunwayChart weeks={cash.weeks} reserveFloor={cash.reserveFloor} currency={cash.currency} />
          </>
        ) : null}

        {pending.length > 0 ? (
          <>
            <Section title="Awaiting your approval" caption="Terms computed by code. The card will enforce exactly these." />
            {pending.map((p) => (
              <ProposalCard key={p.id} proposal={p} onDecided={() => load()} />
            ))}
          </>
        ) : null}

        {cash ? (
          <>
            <Section title="Virtual card" caption="Live on the Airwallex sandbox. Its controls decline anything you did not approve." />
            <VirtualCard card={card} onPress={() => navigation.navigate('Card')} />

            <Section title="Coming up" />
            <View>
              {cash.upcoming.map((f, i) => (
                <View key={`${f.date}-${f.label}`} style={[styles.flow, { borderColor: colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}>
                  <Text style={[styles.flowDate, { color: colors.muted }]}>{formatDay(f.date)}</Text>
                  <Text style={[styles.flowLabel, { color: colors.text }]} numberOfLines={1}>
                    {f.label}
                  </Text>
                  <Text style={[styles.flowAmount, { color: f.amount > 0 ? colors.success : colors.text }]}>
                    {f.amount > 0 ? '+' : '−'}
                    {formatCents(Math.abs(f.amount), cash.currency)}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('Chat')}
        style={({ pressed }) => [
          styles.dock,
          { backgroundColor: colors.ink, borderColor: colors.gold, marginBottom: Math.max(insets.bottom, 12), opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <View style={styles.flex}>
          <Text style={[styles.dockTitle, { color: colors.onInk }]}>Ask the finance agent</Text>
          <Text style={[styles.dockText, { color: colors.inkMuted }]}>It explains. Code decides. You approve.</Text>
        </View>
        <Text style={[styles.dockArrow, { color: colors.gold }]}>→</Text>
      </Pressable>
    </View>
  )

  function Section({ title, caption }: { title: string; caption?: string }) {
    return (
      <View style={styles.section}>
        <Text style={[styles.label, { color: colors.text }]}>{title.toUpperCase()}</Text>
        {caption ? <Text style={[styles.caption, { color: colors.muted }]}>{caption}</Text> : null}
      </View>
    )
  }

  function Stat({ label, value, note, danger }: { label: string; value: string; note: string; danger?: boolean }) {
    return (
      <View style={styles.stat}>
        <Text style={[styles.statLabel, { color: colors.muted }]}>{label}</Text>
        <Text style={[styles.statValue, { color: danger ? colors.danger : colors.text }]}>{value}</Text>
        <Text style={[styles.statNote, { color: colors.muted }]}>{note}</Text>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 18 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 40, height: 34 },
  company: { fontSize: 16, fontWeight: '700' },
  product: { fontSize: 12, letterSpacing: 0.4 },
  topLinks: { flexDirection: 'row', gap: 18 },
  topLink: { fontSize: 15, fontWeight: '600' },
  error: { textAlign: 'center', marginTop: 32 },
  hero: { gap: 4, marginTop: 8 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1.6 },
  balance: { fontFamily: displayFont, fontSize: 48, fontVariant: ['tabular-nums'], marginTop: 2 },
  asOf: { fontSize: 13 },
  split: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 14 },
  divider: { width: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  stat: { flex: 1, gap: 3 },
  statLabel: { fontSize: 12 },
  statValue: { fontFamily: displayFont, fontSize: 22, fontVariant: ['tabular-nums'] },
  statNote: { fontSize: 11 },
  section: { gap: 4, marginTop: 10 },
  caption: { fontSize: 13, lineHeight: 18 },
  flow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  flowDate: { width: 50, fontSize: 13, fontVariant: ['tabular-nums'] },
  flowLabel: { flex: 1, fontSize: 14 },
  flowAmount: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  dockTitle: { fontSize: 16, fontWeight: '700' },
  dockText: { fontSize: 12, marginTop: 2 },
  dockArrow: { fontSize: 24, fontWeight: '300' },
})
