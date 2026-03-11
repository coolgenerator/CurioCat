import { useMemo, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Home, GitBranch, Clock, FileText, Sun, Moon, Github } from 'lucide-react'
import { useAnalysis } from '../../context/AnalysisContext'
import { useT, LanguageToggle } from '../../i18n/index.tsx'
import { useTheme } from '../../hooks/useTheme.ts'

interface AppLayoutProps {
  children: ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
  const location = useLocation()
  const { state } = useAnalysis()
  const { t } = useT()
  const { theme, toggleTheme } = useTheme()

  // Derive projectId from URL or context — URL takes priority
  const projectId = useMemo(() => {
    const match = location.pathname.match(/^\/(graph|compare|analysis)\/([^/]+)/)
    return match?.[2] ?? state.projectId
  }, [location.pathname, state.projectId])

  // Build nav links dynamically — Graph and Compare only available with a project
  const navLinks = [
    { path: '/', label: t.nav.home, icon: Home, enabled: true },
    { path: projectId ? `/graph/${projectId}` : '/graph', label: t.nav.graph, icon: GitBranch, enabled: true },
    { path: '/history', label: t.nav.history, icon: Clock, enabled: true },
    { path: '/reports', label: t.nav.reports, icon: FileText, enabled: true },
  ]

  return (
    <div className="min-h-screen bg-surface-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-surface-700 bg-surface-800/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <img src="/CurioCat-Logo.png" alt="CurioCat" className="w-7 h-7 rounded-sm" />
              <span className="text-lg font-bold text-text-primary group-hover:text-ocean-300 transition-colors">
                {t.common.appName}
              </span>
            </Link>

            {/* Nav */}
            <nav className="flex items-center gap-1">
              {navLinks.map(({ path, label, icon: Icon, enabled }) => {
                const isActive = path !== '#' && (
                  location.pathname === path ||
                  (path !== '/' && location.pathname.startsWith(`/${path.split('/')[1]}`))
                )
                if (!enabled) {
                  return (
                    <span
                      key={label}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-text-muted/40 cursor-not-allowed"
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </span>
                  )
                }
                return (
                  <Link
                    key={label}
                    to={path}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-ocean-500/15 text-ocean-400'
                        : 'text-text-secondary hover:text-text-primary hover:bg-surface-700/50'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                )
              })}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted hidden md:inline">
                {t.common.subtitle}
              </span>
              <button
                onClick={toggleTheme}
                className="p-1.5 rounded-md border border-surface-600 bg-surface-700 text-text-secondary hover:text-text-primary hover:bg-surface-600 transition-colors"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
              <LanguageToggle />
              <a
                href="https://github.com/coolgenerator/CurioCat"
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-md border border-surface-600 bg-surface-700 text-text-secondary hover:text-text-primary hover:bg-surface-600 transition-colors"
                aria-label="GitHub"
              >
                <Github className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  )
}
