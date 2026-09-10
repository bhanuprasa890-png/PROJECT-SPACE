import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App.jsx';
import { calls } from './fakeApi.js';

/** Sign in through the form, then open the first recipe card. */
async function openRecipe() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <App />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Log in', level: 1 });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'chef@mise.dev' } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'MiseDemo#2026' } });
  fireEvent.click(screen.getByRole('button', { name: /^Log in$/i }));
  fireEvent.click(await screen.findByText('Garlic Butter Paneer', undefined, { timeout: 2500 }));
  await screen.findByRole('heading', { name: 'Garlic Butter Paneer', level: 1 }, { timeout: 2500 });
}

describe('cook mode', () => {
  it('shows steps with doneness cues and the copilot that owns each step', async () => {
    await openRecipe();
    expect(await screen.findByText(/Step 1 of 4/i)).toBeTruthy();
    expect(screen.getByText(/Pat the paneer completely dry/i)).toBeTruthy();
    expect(screen.getByText(/→ No shine on the surface/)).toBeTruthy();
    // the copilot for step 1 is Sigma
    expect(screen.getAllByText('Sigma').length).toBeGreaterThan(0);
  });

  it('marks a step done and advances the progress copy', async () => {
    await openRecipe();
    const doneButtons = await screen.findAllByRole('button', { name: /^Done$/i });
    fireEvent.click(doneButtons[0]);
    await waitFor(() => expect(screen.getByText(/3 steps to go/i)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Undo$/i }));
    await waitFor(() => expect(screen.getByText(/4 steps to go/i)).toBeTruthy());
  });

  it('checks ingredients off and scales the quantities', async () => {
    await openRecipe();
    const first = await screen.findByText('400 g paneer, cut into 2.5 cm cubes');
    fireEvent.click(first.closest('button'));
    await waitFor(() => expect(first.closest('button').getAttribute('data-on')).toBe('true'));

    fireEvent.click(screen.getByRole('button', { name: '2×' }));
    await screen.findByText('800 g paneer, cut into 2.5 cm cubes');
    // "serves 4" is split across the chip's <b>, so match on the element text
    expect(screen.getByText((_c, el) => el?.className === 'chip' && /serves\s*4/.test(el.textContent ?? ''))).toBeTruthy();
  });

  it('offers a step timer', async () => {
    await openRecipe();
    expect(await screen.findByText(/Step 1 · 3 min/i)).toBeTruthy();
    expect(screen.getByRole('timer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Start$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Pause/i })).toBeTruthy());
  });

  it('logs the cook and returns to the board with a badge', async () => {
    await openRecipe();
    fireEvent.click(await screen.findByRole('button', { name: /Finish & log this cook/i }));
    await waitFor(() => expect(calls.some((c) => c.path.includes('/cooked') && c.method === 'POST')).toBe(true));
    await screen.findByText(/Cooked/i, undefined, { timeout: 2500 });
  });
});
