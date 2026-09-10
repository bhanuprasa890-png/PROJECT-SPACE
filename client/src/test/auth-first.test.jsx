import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { calls } from './fakeApi.js';

/* ------------------------------------------------------------------ *
 * Helpers — one render per test, ^-anchored label queries so the
 * "Show password" aria-label never collides with the Password field.
 * ------------------------------------------------------------------ */
const renderAt = (path = '/login') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );

const emailField = () => screen.getByLabelText(/^Email/);
const passwordField = () => screen.getByLabelText(/^Password/);

const openLogin = async (path = '/login') => {
  renderAt(path);
  await screen.findByRole('heading', { name: 'Log in', level: 1 });
};

const logInWithPassword = async (email, password) => {
  fireEvent.change(emailField(), { target: { value: email } });
  fireEvent.change(passwordField(), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /^Log in$/i }));
};

/** Full journey: login screen → signed-in board. */
const signIn = async () => {
  await openLogin();
  await logInWithPassword('chef@mise.dev', 'MiseDemo#2026');
  await screen.findByText('Garlic Butter Paneer', undefined, { timeout: 2500 });
};

describe('the login page is the first screen', () => {
  it('shows only the login form at / when signed out', async () => {
    await openLogin('/');

    expect(screen.getByRole('heading', { name: 'Log in', level: 1 })).toBeTruthy();
    expect(screen.getAllByRole('heading').length).toBe(1);

    // nothing protected leaks onto this screen: no nav, no hero, no cards
    expect(screen.queryByText('Recipe cards')).toBeNull();
    expect(screen.queryByText('Garlic Butter Paneer')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Kitchen' })).toBeNull();
    expect(screen.queryByRole('banner')).toBeNull();

    // wording contract: Log in / Log out / Create new account — never "Sign …"
    expect(screen.getByRole('link', { name: /Create new account/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sign up/i);

    await waitFor(() => expect(document.title).toBe('Mise · Log in'));
  });

  it('lands any other unauthenticated path on /login, protected UI unmounted', async () => {
    renderAt('/recipes/garlic-butter-paneer');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in', level: 1 })).toBeTruthy());
    expect(screen.queryByText('Recipe cards')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('masks the password until reveal is pressed', async () => {
    await openLogin();
    expect(passwordField().getAttribute('type')).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /Show password/i }));
    expect(passwordField().getAttribute('type')).toBe('text');
  });

  it('signs in through the Google demo chooser', async () => {
    await openLogin();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));

    const dialog = await screen.findByRole('dialog', { name: /Choose an account/i });
    expect(within(dialog).getAllByRole('button', { name: /@gmail\.com/ })).toHaveLength(3);
    expect(within(dialog).getByText('priya.nair@gmail.com')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: /Next/i }));
    await screen.findByText('Garlic Butter Paneer', undefined, { timeout: 2500 });
    expect(calls.some((c) => c.path === '/api/auth/google/demo' && c.body.email === 'priya.nair@gmail.com')).toBe(true);
  });

  it('surfaces a wrong demo passcode inside the sheet', async () => {
    await openLogin();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));
    const dialog = await screen.findByRole('dialog', { name: /Choose an account/i });
    fireEvent.change(within(dialog).getByLabelText(/Demo passcode/i), { target: { value: 'nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Next/i }));
    await waitFor(() => expect(within(dialog).getByText(/passcode/i)).toBeTruthy());
    expect(screen.queryByText('Garlic Butter Paneer')).toBeNull();
  });

  it('fills the form from a demo credential chip', async () => {
    await openLogin();
    fireEvent.click(await screen.findByRole('button', { name: /priya\.nair@gmail\.com/ }));
    expect(emailField().value).toBe('priya.nair@gmail.com');
    expect(passwordField().value).toBe('MiseDemo#2026');
  });
});

describe('log in → cards → log out', () => {
  it('reveals the copilot cards and recipe cards after login', async () => {
    await signIn();

    expect(screen.getByText('Recipe cards')).toBeTruthy();
    expect(screen.getByText('Weeknight Yellow Dal')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Five copilots, each with one job/i })).toBeTruthy();
    expect(screen.getByText('Sigma')).toBeTruthy();
    expect(screen.getByText('Manus')).toBeTruthy();
    expect(screen.getByText('Nova')).toBeTruthy();
    expect(screen.queryByText('Log in', { selector: 'h1' })).toBeNull();
    expect(document.title).toBe('Mise · Kitchen');
  });

  it('refuses a bad password and stays on the login screen', async () => {
    await openLogin();
    await logInWithPassword('chef@mise.dev', 'wrong-password');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not correct/i));
    expect(screen.getByRole('heading', { name: 'Log in', level: 1 })).toBeTruthy();
    expect(screen.queryByText('Recipe cards')).toBeNull();
  });

  it('logs out on a dedicated logout page, then requires login again', async () => {
    await signIn();
    fireEvent.click(screen.getAllByRole('link', { name: /^Log out$/i })[0]);

    await screen.findByRole('heading', { name: /You are logged out/i }, { timeout: 2500 });
    expect(calls.some((c) => c.path === '/api/auth/logout' && c.method === 'POST')).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: /Log in again/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Log in', level: 1 })).toBeTruthy());
    expect(screen.queryByText('Recipe cards')).toBeNull();
  });

  it('persists a favourite through the API', async () => {
    await signIn();
    fireEvent.click(screen.getAllByRole('button', { name: /Add to favourites/i })[0]);
    await waitFor(() => expect(calls.some((c) => c.path.includes('/favorite') && c.body.favorite === true)).toBe(true));
  });

  it('filters and searches the card grid', async () => {
    await signIn();
    fireEvent.click(screen.getByRole('button', { name: /Vegan/i }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('/api/recipes?') && c.path.includes('tag=vegan'))).toBe(true));

    fireEvent.change(screen.getByPlaceholderText(/Search dish or ingredient/i), { target: { value: 'dal' } });
    await waitFor(() => expect(calls.some((c) => c.path.includes('q=dal'))).toBe(true));
  });
});

describe('create new account', () => {
  it('uses the required wording and validates before posting', async () => {
    renderAt('/create-account');
    expect(await screen.findByRole('heading', { name: 'Create new account', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Log in/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sign up/i);

    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'New Cook' } });
    fireEvent.change(emailField(), { target: { value: 'new.cook@example.com' } });
    const password = passwordField();
    fireEvent.change(password, { target: { value: 'weak' } });
    expect(await screen.findByText(/At least 10 characters/i)).toBeTruthy();

    const submit = screen.getByRole('button', { name: /Create new account/i });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(password, { target: { value: 'Saffron#Pan2026!' } });
    fireEvent.change(screen.getByLabelText(/Re-enter password/i), { target: { value: 'Saffron#Pan2026!' } });
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
    fireEvent.click(submit);

    await screen.findByText('Garlic Butter Paneer', undefined, { timeout: 2500 });
    expect(calls.find((c) => c.path === '/api/auth/register').body).toMatchObject({
      name: 'New Cook',
      email: 'new.cook@example.com',
    });
  });

  it('flags mismatched confirmation live and does not post', async () => {
    renderAt('/create-account');
    await screen.findByRole('heading', { name: 'Create new account' });
    fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'New Cook' } });
    fireEvent.change(emailField(), { target: { value: 'mismatch@example.com' } });
    fireEvent.change(passwordField(), { target: { value: 'Saffron#Pan2026!' } });
    fireEvent.change(screen.getByLabelText(/Re-enter password/i), { target: { value: 'Saffron#Pan2026?' } });
    expect(await screen.findByText(/do not match/i)).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/auth/register')).toBe(false);
  });
});

describe('3D policy', () => {
  it('renders static art, not a canvas, where WebGL is unavailable', async () => {
    await openLogin();
    expect(document.querySelector('canvas')).toBeNull();
    expect(document.querySelector('.auth__aside-poster')).toBeTruthy();
  });

  it('exposes a 3D switch in the signed-in top bar', async () => {
    await signIn();
    expect(screen.getAllByRole('button', { name: /3D on|Auto · on/i }).length).toBeGreaterThan(0);
  });
});
