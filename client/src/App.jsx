import { Route, Routes, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider.jsx';
import LoginPage from './pages/LoginPage.jsx';
import CreateAccountPage from './pages/CreateAccountPage.jsx';
import LogoutPage from './pages/LogoutPage.jsx';
import HomePage from './pages/HomePage.jsx';
import RecipePage from './pages/RecipePage.jsx';
import AccountPage from './pages/AccountPage.jsx';

/**
 * Routing rule the brief asked for: the login page IS the first screen.
 * While there is no session, the entire app renders only authentication UI —
 * no nav, no hero, no headings competing with the form, and the protected
 * routes are not even mounted (the API refuses them too).
 */
function BootScreen() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <div className="boot__ring" aria-hidden="true" />
      <p className="muted">Checking your session…</p>
    </div>
  );
}

function Shell() {
  const { status, isAuthenticated } = useAuth();

  if (status === 'checking') return <BootScreen />;

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/create-account" element={<CreateAccountPage />} />
        <Route path="/logout" element={<LogoutPage signedOut />} />
        {/* every other entry point lands on the login page, nothing else */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/recipes/:id" element={<RecipePage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/logout" element={<LogoutPage />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/create-account" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
