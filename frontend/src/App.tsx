import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useTheme } from './hooks/useTheme.ts'
import { LanguageProvider } from './i18n/index.tsx'
import { AnalysisProvider } from './context/AnalysisContext.tsx'
import ErrorBoundary from './components/ui/ErrorBoundary.tsx'
import AppLayout from './components/layout/AppLayout.tsx'
import InputScreen from './components/input/InputScreen.tsx'
import ProcessingScreen from './components/processing/ProcessingScreen.tsx'
import GraphScreen from './components/tree/GraphScreen.tsx'
import GraphListScreen from './components/tree/GraphListScreen.tsx'
import ComparisonView from './components/scenario/ComparisonView.tsx'
import ReportsScreen from './components/scenario/ReportsScreen.tsx'

function AppContent() {
  const { theme } = useTheme()
  return (
    <BrowserRouter>
      <Routes>
            <Route
              path="/"
              element={
                <AppLayout>
                  <InputScreen />
                </AppLayout>
              }
            />
            <Route
              path="/analysis/:projectId"
              element={
                <AppLayout>
                  <ProcessingScreen />
                </AppLayout>
              }
            />
            <Route
              path="/graph"
              element={
                <AppLayout>
                  <GraphListScreen />
                </AppLayout>
              }
            />
            <Route
              path="/history"
              element={
                <AppLayout>
                  <GraphListScreen />
                </AppLayout>
              }
            />
            <Route
              path="/reports"
              element={
                <AppLayout>
                  <ReportsScreen />
                </AppLayout>
              }
            />
            <Route
              path="/graph/:projectId"
              element={
                <AppLayout>
                  <GraphScreen />
                </AppLayout>
              }
            />
            <Route
              path="/compare/:projectId"
              element={
                <AppLayout>
                  <ComparisonView />
                </AppLayout>
              }
            />
      </Routes>
      <Toaster theme={theme} position="bottom-right" />
    </BrowserRouter>
  )
}

function App() {
  return (
    <LanguageProvider>
    <ErrorBoundary>
      <AnalysisProvider>
        <AppContent />
      </AnalysisProvider>
    </ErrorBoundary>
    </LanguageProvider>
  )
}

export default App
