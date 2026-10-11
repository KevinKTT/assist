import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider } from './app-context'
import { DaysPage } from './pages/DaysPage'
import { HoursPage, MilesPage } from './pages/LogPage'
import { ReportsPage } from './pages/ReportsPage'
import { Shell } from './pages/Shell'

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<HoursPage />} />
            <Route path="miles" element={<MilesPage />} />
            <Route path="days" element={<DaysPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  )
}
