import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { en, type Translations } from './en'
import { zh } from './zh'

export type { Translations }
export type Lang = 'en' | 'zh'

const translations: Record<Lang, Translations> = { en, zh }

interface LanguageContextValue {
  t: Translations
  lang: Lang
  setLang: (lang: Lang) => void
}

const LanguageContext = createContext<LanguageContextValue>({
  t: en,
  lang: 'en',
  setLang: () => {},
})

function detectInitialLang(): Lang {
  try {
    const stored = localStorage.getItem('curiocat-lang')
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    // localStorage unavailable
  }
  const nav = navigator.language.toLowerCase()
  if (nav.startsWith('zh')) return 'zh'
  return 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang)

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang)
    try {
      localStorage.setItem('curiocat-lang', newLang)
    } catch {
      // localStorage unavailable
    }
  }, [])

  return (
    <LanguageContext.Provider value={{ t: translations[lang], lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useT() {
  return useContext(LanguageContext)
}

export function LanguageToggle() {
  const { lang, setLang } = useT()

  return (
    <button
      onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
      className="px-2 py-1 text-xs font-medium rounded-md border border-surface-600 bg-surface-700 text-text-secondary hover:text-text-primary hover:bg-surface-600 transition-colors"
      aria-label="Toggle language"
    >
      {lang === 'en' ? '中' : 'EN'}
    </button>
  )
}
