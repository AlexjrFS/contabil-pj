// Light and dark colors, following the system setting. The palette comes from the logo: ivory, espresso
// (the splash background) and gold. `ink` is the face of the virtual card in both modes.
import { createContext, useContext, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { fonts } from './fonts'

const light = {
  background: '#F4F0E8',
  surface: '#FFFDF9',
  border: '#E4DCCD',
  text: '#1C140C',
  muted: '#6E6355',
  primary: '#86601C',
  onPrimary: '#FFFFFF',
  userBubble: '#2A1E12',
  onUserBubble: '#F6EEDD',
  success: '#2F7A3E',
  danger: '#B3261E',
  warning: '#9A5B0B',
  chip: '#EFE6D3',
  ink: '#130B05',
  onInk: '#F3E9D6',
  inkMuted: '#A8987E',
  gold: '#D4A64A',
  bar: '#CDBFA6',
}

export type Colors = typeof light

const dark: Colors = {
  background: '#130B05',
  surface: '#1E150D',
  border: '#33271B',
  text: '#F3E9D6',
  muted: '#A8987E',
  primary: '#D4A64A',
  onPrimary: '#1C140C',
  userBubble: '#3A2B19',
  onUserBubble: '#F3E9D6',
  success: '#6FCF7F',
  danger: '#F08A80',
  warning: '#E6B04C',
  chip: '#2A1F14',
  ink: '#2A1D10',
  onInk: '#F3E9D6',
  inkMuted: '#A8987E',
  gold: '#D4A64A',
  bar: '#5A4A35',
}

// IBM Plex Serif for headline numbers (see fonts.ts)
export const displayFont = fonts.display

const ThemeContext = createContext<{ colors: Colors; dark: boolean }>({ colors: light, dark: false })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const isDark = useColorScheme() === 'dark'
  return <ThemeContext.Provider value={{ colors: isDark ? dark : light, dark: isDark }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
