import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { RootNavigator } from './src/navigation/RootNavigator'
import { FONT_FILES } from './src/theme/fonts'
import { ThemeProvider } from './src/theme/ThemeContext'

export default function App() {
  // Wait for IBM Plex (bundled, so this is quick); if it fails, the system font takes over
  const [loaded, error] = useFonts(FONT_FILES)
  if (!loaded && !error) return null
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="auto" />
        <RootNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
