// The cash policy made visible: the lowest balance of each of the next 12 weeks against the reserve floor.
// One series, so no legend; weeks below the reserve are red and say so in the readout. Tap a week to read it.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { WeekProjection } from '../../../api/types'
import { useTheme } from '../../../theme/ThemeContext'
import { formatCents, formatDay, formatWhole } from '../../../utils/format'

const HEIGHT = 128

export function RunwayChart({ weeks, reserveFloor, currency }: { weeks: WeekProjection[]; reserveFloor: number; currency: string }) {
  const { colors } = useTheme()
  const lowestWeek = weeks.reduce((min, w) => (w.lowest < min.lowest ? w : min), weeks[0]!)
  // Until the founder taps a week, follow the lowest one, which moves when a card adds its charges
  const [selected, setSelected] = useState<number | null>(null)
  const week = weeks.find((w) => w.week === (selected ?? lowestWeek.week)) ?? lowestWeek
  const top = Math.max(reserveFloor, ...weeks.map((w) => w.lowest)) * 1.08
  const y = (value: number) => (Math.max(value, 0) / top) * HEIGHT

  return (
    <View style={styles.wrap}>
      <View style={styles.readoutRow}>
        <View style={styles.readout}>
          <Text style={[styles.readoutLabel, { color: colors.muted }]}>
            Week {week.week} · {formatDay(week.start)}–{formatDay(week.end)}
          </Text>
          <Text style={[styles.readoutValue, { color: colors.text }]}>
            Lowest {formatCents(week.lowest, currency)}
            {week.breach ? <Text style={{ color: colors.danger }}> · below reserve</Text> : null}
          </Text>
        </View>
        <View style={styles.key}>
          <View style={[styles.keyLine, { backgroundColor: colors.text }]} />
          <Text style={[styles.readoutLabel, { color: colors.muted }]}>Reserve {formatWhole(reserveFloor, currency)}</Text>
        </View>
      </View>

      <View style={{ height: HEIGHT }}>
        <View style={styles.bars}>
          {weeks.map((w) => {
            const active = w.week === week.week
            const fill = w.breach ? colors.danger : active ? colors.primary : colors.bar
            return (
              <Pressable
                key={w.week}
                accessibilityRole="button"
                accessibilityLabel={`Week ${w.week}, lowest ${formatCents(w.lowest, currency)}${w.breach ? ', below reserve' : ''}`}
                onPress={() => setSelected(w.week)}
                style={styles.hit}
              >
                <View style={[styles.bar, { height: Math.max(y(w.lowest), 2), backgroundColor: fill }]} />
              </Pressable>
            )
          })}
        </View>
        {/* Drawn over the bars: the line every week must stay above */}
        <View pointerEvents="none" style={[styles.reserve, { bottom: y(reserveFloor), backgroundColor: colors.text }]} />
      </View>

      <View style={[styles.axis, { borderColor: colors.border }]}>
        {weeks.map((w) => (
          <Text key={w.week} style={[styles.tick, { color: w.week === week.week ? colors.text : colors.muted }]}>
            {w.week}
          </Text>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  readoutRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  readout: { gap: 2, flexShrink: 1 },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 2 },
  keyLine: { width: 16, height: 2 },
  readoutLabel: { fontSize: 12, letterSpacing: 0.3 },
  readoutValue: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  reserve: { position: 'absolute', left: 0, right: 0, height: 2, opacity: 0.75 },
  bars: { ...StyleSheet.absoluteFill, flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  hit: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: { flexDirection: 'row', gap: 4, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  tick: { flex: 1, textAlign: 'center', fontSize: 10, fontVariant: ['tabular-nums'] },
})
