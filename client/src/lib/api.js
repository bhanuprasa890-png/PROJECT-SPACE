/**
 * Thin fetch wrapper. Same-origin `/api` only — no localhost URLs, so it works
 * behind any proxy. The CSRF token is captured from any successful auth
 * response and echoed back on writes.
 */
let csrfToken = null;
let onUnauthorized = () => {};

export const setCsrfToken = (token) => {
  if (typeof token === 'string' && token) csrfToken = token;
};
export const getCsrfToken = () => csrfToken;
export const onUnauthorizedEvent = (handler) => {
  onUnauthorized = handler;
};

export class ApiError extends Error {
  constructor(message, { status, fields, code } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields || null;
    this.code = code || null;
  }
}

export async function api(path, { method = 'GET', body, expectJson = true } = {}) {
  const headers = { accept: 'application/json' };
  const isWrite = method !== 'GET' && method !== 'HEAD';
  if (isWrite && csrfToken) headers['x-csrf-token'] = csrfToken;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the kitchen service. Is the server running?', { status: 0 });
  }

  const payload = expectJson && response.status !== 204 ? await response.json().catch(() => null) : null;

  if (payload?.csrfToken) setCsrfToken(payload.csrfToken);

  if (!response.ok) {
    if (response.status === 401 && payload?.code === 'AUTH_REQUIRED') onUnauthorized();
    throw new ApiError(payload?.error || `Request failed (${response.status})`, {
      status: response.status,
      fields: payload?.fields,
      code: payload?.code,
    });
  }
  return payload;
}
