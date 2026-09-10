import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import BrandMark from '../components/BrandMark.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';

/**
 * A real logout page (not just a button). It ends the session on the server,
 * shows what was revoked, and returns you to the log-in screen.
 */
export default function LogoutPage({ signedOut = false }) {
  const { logout, user, setFlash } = useAuth();
  const navigate = useNavigate();
  const [phase, setPhase] = useState(signedOut ? 'done' : 'idle'); // idle | working | done
  const [remembered] = useState(user?.email ?? '');

  useEffect(() => {
    document.title = 'Mise · Log out';
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (phase === 'idle') {
      setPhase('working');
      (async () => {
        try {
          await logout();
          if (!cancelled) setFlash('You are logged out. Your session was revoked on the server.');
        } finally {
          if (!cancelled) setPhase('done');
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [phase, logout, setFlash]);

  const done = phase === 'done' || signedOut;

  return (
    <main className="farewell" id="main">
      <motion.div
        className="farewell__card"
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.16, 0.84, 0.24, 1] }}
      >
        <BrandMark size={40} withWord={false} />
        <h1 className="farewell__title">{done ? 'You are logged out' : 'Logging you out…'}</h1>
        <p className="muted" style={{ maxWidth: '40ch' }}>
          {done
            ? 'Your session cookie was revoked, so a copied cookie no longer works. Nothing was deleted — your favourites and history are still here.'
            : 'Clearing the session and revoking the server-side token.'}
        </p>

        {done ? (
          <>
            <ul className="farewell__list">
              <li>
                <span style={{ color: 'var(--color-accent-herb)' }}>✓</span> Session revoked{remembered ? ` for ${remembered}` : ''}
              </li>
              <li>
                <span style={{ color: 'var(--color-accent-herb)' }}>✓</span> Cookie cleared from this browser
              </li>
              <li>
                <span style={{ color: 'var(--color-accent-herb)' }}>✓</span> Recipe history and favourites kept on your account
              </li>
            </ul>
            <div style={{ display: 'flex', gap: 'var(--size-space-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
              <Link to="/login" className="btn btn--primary">
                Log in again
              </Link>
              <button type="button" className="btn btn--ghost" onClick={() => navigate('/', { replace: true })}>
                Back to the kitchen
              </button>
            </div>
          </>
        ) : (
          <div className="boot__ring" aria-hidden="true" />
        )}
      </motion.div>
    </main>
  );
}
