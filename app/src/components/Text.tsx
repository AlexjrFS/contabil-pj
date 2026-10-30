// Text in IBM Plex: picks the family from the style's fontWeight, so screens keep writing fontWeight as usual.
// Nested Text without its own weight inherits the parent's family instead of falling back to regular.
import { createContext, useContext } from 'react'
import { Text as NativeText, StyleSheet, type TextProps } from 'react-native'
import { familyFor } from '../theme/fonts'

const InsideText = createContext(false)

export function Text({ style, ...props }: TextProps) {
  const nested = useContext(InsideText)
  const flat = StyleSheet.flatten(style) ?? {}
  const own = flat.fontFamily !== undefined || flat.fontWeight !== undefined
  const font = nested && !own ? null : { fontFamily: flat.fontFamily ?? familyFor(flat.fontWeight), fontWeight: 'normal' as const }
  return (
    <InsideText.Provider value>
      <NativeText {...props} style={font ? [style, font] : style} />
    </InsideText.Provider>
  )
}
