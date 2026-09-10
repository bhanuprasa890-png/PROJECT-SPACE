import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { CommuterDashboard } from './pages/CommuterDashboard';
import { RouteResults } from './pages/RouteResults';
import { RouteDetails } from './pages/RouteDetails';
import { OperatorDashboard } from './pages/OperatorDashboard';
import { AlertsPage } from './pages/AlertsPage';
import { SettingsPage } from './pages/SettingsPage';
import { DataExplorerPage } from './pages/DataExplorerPage';
import { EmptyState } from './components/ui/Skeleton';
import { Button } from './components/ui/Button';
import { Compass } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function NotFound() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<Compass className="size-5" />}
      title="That screen does not exist"
      description="The link may be out of date. Head back to your dashboard to keep planning."
      action={
        <Button size="sm" variant="primary" onClick={() => navigate('/')}>
          Back to dashboard
        </Button>
      }
    />
  );
}

/**
 * Application routes.
 *
 *   /                       Commuter dashboard
 *   /routes                 Route results (origin/destination in the query string)
 *   /routes/details         Route details for a single option
 *   /operator               Operator dashboard
 *   /alerts                 Alerts feed + publishing
 *   /settings               Rider preferences and saved journeys
 *   /database               Data explorer — live records from Postgres
 */
export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<CommuterDashboard />} />
        <Route path="routes" element={<RouteResults />} />
        <Route path="routes/details" element={<RouteDetails />} />
        <Route path="operator" element={<OperatorDashboard />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="database" element={<DataExplorerPage />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
