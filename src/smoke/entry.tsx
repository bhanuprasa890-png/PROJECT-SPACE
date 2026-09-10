import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from '../App';

/**
 * Smoke-render entry used by `npm run smoke`.
 *
 * It mounts the real application — same providers, same components, same API
 * calls — inside jsdom so we can prove every route renders against a live API
 * without a browser.
 */
export async function renderRoute(path: string, settleMs = 1800): Promise<string> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });

  const container = document.createElement('div');
  container.id = 'smoke-root';
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );

  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const html = container.innerHTML;

  root.unmount();
  container.remove();
  client.clear();

  return html;
}
