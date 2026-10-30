// IBM Plex: Sans for text, Serif for headline numbers. Loaded with expo-font (already in the installed build), so a
// font change ships over the air. Custom fonts ignore fontWeight on Android: each weight is its own family.
import { IBMPlexSans_400Regular } from '@expo-google-fonts/ibm-plex-sans/400Regular'
import { IBMPlexSans_500Medium } from '@expo-google-fonts/ibm-plex-sans/500Medium'
import { IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans/600SemiBold'
import { IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans/700Bold'
import { IBMPlexSerif_400Regular } from '@expo-google-fonts/ibm-plex-serif/400Regular'
import type { TextStyle } from 'react-native'

export const FONT_FILES = {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
  IBMPlexSerif_400Regular,
}

export const fonts = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  bold: 'IBMPlexSans_700Bold',
  display: 'IBMPlexSerif_400Regular',
} as const

// The Plex family for a fontWeight written in a style
export function familyFor(weight: TextStyle['fontWeight']): string {
  switch (String(weight ?? '400')) {
    case '500':
      return fonts.medium
    case '600':
      return fonts.semibold
    case '700':
    case '800':
    case '900':
    case 'bold':
      return fonts.bold
    default:
      return fonts.regular
  }
}
