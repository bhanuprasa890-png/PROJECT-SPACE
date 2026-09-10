import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import BrandMark from './BrandMark.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useMotionMode } from '../three/sceneUtils.js';

const SECTIONS = [
  { id: 'copilots', label: '3D copilots' },
  { id: 'recipes', label: 'Recipes' },
  { id: 'pantry', label: 'Pantry' },
];

export default function TopBar() {
  const { user, config } = useAuth();
  const { label, cycle } = useMotionMode();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('');
  const wrapRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const onClick = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // Scroll-spy: the nav pill reflects the section under the sticky bar.
  useEffect(() => {
    if (location.pathname !== '/') return undefined;
    const targets = SECTIONS.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!targets.length || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        setActive(visible?.target?.id ?? '');
      },
      { rootMargin: '-96px 0px -55% 0px', threshold: [0.05, 0.3, 0.6] }
    );
    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [location.pathname]);

  // Deep links like /#recipes scroll once the cards exist.
  useEffect(() => {
    if (!location.hash) return undefined;
    const id = location.hash.replace('#', '');
    const timer = setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 220);
    return () => clearTimeout(timer);
  }, [location.hash, location.pathname]);

  const jump = (id) => {
    setActive(id);
    if (location.pathname !== '/') {
      navigate(`/#${id}`);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const initials = (user?.name || user?.email || 'M')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  return (
    <header className="topbar">
      <Link to="/" className="topbar__brand" aria-label="Mise home">
        <BrandMark size={30} />
      </Link>

      <nav className="topbar__nav" aria-label="Sections">
        <button type="button" data-active={active === '' && location.pathname === '/'} onClick={() => (location.pathname === '/' ? window.scrollTo({ top: 0, behavior: 'smooth' }) : navigate('/'))}>
          Kitchen
        </button>
        {SECTIONS.map((section) => (
          <button type="button" key={section.id} data-active={active === section.id} onClick={() => jump(section.id)}>
            {section.label}
          </button>
        ))}
        <Link to="/account" data-active={location.pathname === '/account'}>
          Account
        </Link>
      </nav>

      <span className="topbar__spacer" />

      <div className="topbar__tools">
        <button type="button" className="btn btn--ghost btn--sm" onClick={cycle} title="Toggle 3D animations (helps older GPUs and reduced-motion users)">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 2.6l8.4 4.6v9.6L12 21.4 3.6 16.8V7.2L12 2.6z" />
            <path d="M3.8 7.2L12 11.8l8.2-4.6M12 11.8v9.4" />
          </svg>
          {label}
        </button>
        <span
          className="chip"
          title={config?.googleMode === 'live' ? 'Google OAuth is live' : 'Google sign-in is running in demo mode'}
          style={{ textTransform: 'capitalize' }}
        >
          google: {config?.googleMode ?? 'demo'}
        </span>

        <div className="userchip" ref={wrapRef}>
          <button type="button" className="userchip__btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span className="userchip__meta">
              <b style={{ fontSize: 'var(--font-size-sm)' }}>{user?.name}</b>
              <small>{user?.provider === 'google' ? 'Google account' : 'email account'}</small>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {open ? (
            <div className="usermenu" role="menu" aria-label="Account menu">
              <div className="usermenu__head">
                <b>{user?.name}</b>
                <small className="dim">{user?.email}</small>
                <small className="dim">
                  joined {new Date(user?.createdAt ?? Date.now()).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                </small>
              </div>
              <div className="usermenu__sep" />
              <button type="button" className="usermenu__row" role="menuitem" onClick={() => { setOpen(false); navigate('/account'); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.4" /><path d="M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5" /></svg>
                Account &amp; sessions
              </button>
              <button type="button" className="usermenu__row" role="menuitem" onClick={() => { setOpen(false); navigate('/'); jump('recipes'); setTimeout(() => document.querySelector('[data-filter="favorites"]')?.click(), 260); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 4h14v16l-7-3-7 3V4z" /></svg>
                My favourites
              </button>
              <div className="usermenu__sep" />
              <Link to="/logout" className="usermenu__row usermenu__row--danger" role="menuitem" onClick={() => setOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 5h4v14h-4M10 8l-4 4 4 4M6 12h9" /></svg>
                Log out
              </Link>
            </div>
          ) : null}
        </div>

        <Link to="/logout" className="btn btn--ghost btn--sm">
          Log out
        </Link>
      </div>
    </header>
  );
}
