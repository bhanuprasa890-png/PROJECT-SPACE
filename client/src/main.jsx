import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/tokens.css';
import './styles/app.css';

// Theme + 3D preferences are UI settings, not auth state — localStorage is fine.
// (Never store tokens here: the session lives in an httpOnly cookie.)
const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('mise:theme') : null;
if (stored) document.documentElement.dataset.theme = stored;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
