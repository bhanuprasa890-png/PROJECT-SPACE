import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from '../App';
import { queryClient } from '../lib/queryClient';

/**
 * Recovery-check entry used by `npm run check:recovery`.
 *
 * Unlike `renderRoute` (which uses a throwaway client with `retry: false`), this
 * mounts the app with the **real** `queryClient`, so the production retry,
 * refetch and recovery behaviour is what gets exercised — that is the code path
 * that decides whether a dashboard survives the API restarting underneath it.
 */
let root: Root | null = null;
let container: HTMLDivElement | null = null;

export function mountApp(path: string): void {
  container = document.createElement('div');
  container.id = 'recovery-root';
  document.body.appendChild(container);

  root = createRoot(container);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

export function readHtml(): string {
  return container?.innerHTML ?? '';
}

export function unmountApp(): void {
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
}

/** `dashboard:error(fails:2) | health:success …` — used in the check output. */
export function cacheState(): string {
  return queryClient
    .getQueryCache()
    .getAll()
    .map((query) => {
      const failures = query.state.fetchFailureCount ? `(fails:${query.state.fetchFailureCount})` : '';
      return `${String(query.queryKey[0])}:${query.state.status}${failures}`;
    })
    .join(' | ');
}
