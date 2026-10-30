// The issued card drawn as a card, with what Airwallex says is left this period. Without a card, an outline
// that says how one comes to exist: the agent proposes, the founder approves.
import { Pressable, StyleSheet, View } from 'react-native'
import { Text } from '../../../components/Text'
import type { CardView } from '../../../api/types'
import { displayFont, useTheme } from '../../../theme/ThemeContext'
import { describeCategory, formatMajor } from '../../../utils/format'

export function VirtualCard({ card, onPress }: { card: CardView | null; onPress: () => void }) {
  const { colors } = useTheme()

  if (!card) {
    return (
      <View style={[styles.empty, { borderColor: colors.bar }]}>
        <Text style={[styles.emptyTitle, { color: colors.text }]}>No card yet</Text>
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          The agent proposes a card with limits computed by the cash policy. Nothing is issued until you approve it.
        </Text>
      </View>
    )
  }

  const { card: c, limits } = card
  const last4 = c.card_number?.slice(-4) ?? '····'
  const active = c.card_status === 'ACTIVE'
  const period = limits.limits.find((l) => l.interval !== 'PER_TRANSACTION')
  const perCharge = limits.limits.find((l) => l.interval === 'PER_TRANSACTION')
  const used = period && period.amount > 0 ? Math.min(1, Math.max(0, 1 - period.remaining / period.amount)) : 0
  const controls = c.authorization_controls

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open the card controls and test charges" onPress={onPress} style={styles.wrap}>
      <View style={[styles.face, { backgroundColor: colors.ink, borderColor: colors.gold }]}>
        <View style={styles.row}>
          <Text style={[styles.caps, { color: colors.inkMuted }]}>{(c.nick_name ?? 'Virtual card').toUpperCase()}</Text>
          <Text style={[styles.brand, { color: colors.gold }]}>{(c.brand ?? '').toUpperCase()}</Text>
        </View>
        <View style={[styles.chip, { backgroundColor: colors.gold }]} />
        <Text style={[styles.number, { color: colors.onInk }]}>•••• •••• •••• {last4}</Text>
        <View style={styles.row}>
          <View>
            <Text style={[styles.tiny, { color: colors.inkMuted }]}>CARDHOLDER</Text>
            <Text style={[styles.holder, { color: colors.onInk }]}>{c.name_on_card ?? '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.tiny, { color: colors.inkMuted }]}>STATUS</Text>
            <Text style={[styles.holder, { color: active ? colors.gold : colors.danger }]}>{c.card_status}</Text>
          </View>
        </View>
      </View>

      {period ? (
        <View style={styles.meter}>
          <View style={styles.row}>
            <Text style={[styles.meterLabel, { color: colors.muted }]}>{period.interval === 'MONTHLY' ? 'This month' : 'Total'}</Text>
            <Text style={[styles.meterValue, { color: colors.text }]}>
              {formatMajor(period.remaining, limits.currency)} left of {formatMajor(period.amount, limits.currency)}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View style={[styles.fill, { width: `${used * 100}%`, backgroundColor: colors.primary }]} />
          </View>
          <Text style={[styles.terms, { color: colors.muted }]}>
            {perCharge ? `${formatMajor(perCharge.amount, limits.currency)} per charge · ` : ''}
            {(controls?.allowed_currencies ?? []).join(', ') || 'any currency'} ·{' '}
            {(controls?.allowed_merchant_categories ?? []).map(describeCategory).join(', ') || 'any merchant'}
          </Text>
          <Text style={[styles.link, { color: colors.primary }]}>Controls and test charges ›</Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  face: { aspectRatio: 1.586, borderRadius: 18, padding: 20, justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth },
  empty: { borderRadius: 18, padding: 20, paddingVertical: 28, borderWidth: 1, borderStyle: 'dashed', gap: 8 },
  emptyTitle: { fontFamily: displayFont, fontSize: 22 },
  emptyText: { fontSize: 13, lineHeight: 19, maxWidth: 280 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  caps: { fontSize: 11, fontWeight: '600', letterSpacing: 1.6, flexShrink: 1 },
  brand: { fontSize: 15, fontWeight: '700', letterSpacing: 1.5 },
  chip: { width: 38, height: 28, borderRadius: 6, opacity: 0.85 },
  number: { fontFamily: displayFont, fontSize: 21, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  tiny: { fontSize: 9, fontWeight: '600', letterSpacing: 1.4, marginBottom: 2 },
  holder: { fontSize: 13, fontWeight: '600', letterSpacing: 0.6 },
  meter: { gap: 8 },
  meterLabel: { fontSize: 13 },
  meterValue: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  terms: { fontSize: 12, lineHeight: 17 },
  link: { fontSize: 13, fontWeight: '600' },
})
