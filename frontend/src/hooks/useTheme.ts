import { useState, useCallback, useEffect } from 'react'

export type Theme = 'dark' | 'light'

function detectInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('curiocat-theme')
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // localStorage unavailable
  }
  return 'dark'
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(detectInitialTheme)

  // Apply data-theme attribute to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    try {
      localStorage.setItem('curiocat-theme', newTheme)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return { theme, setTheme, toggleTheme }
}
