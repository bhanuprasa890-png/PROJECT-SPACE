import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { installFakeFetch, resetApi } from './fakeApi.js';

/* matchMedia: "no preference" so motion is on but nothing animates for real.
   Deliberately not a vi.fn() — vitest's restoreMocks would strip the impl. */
const noop = () => {};
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  }),
});

/* jsdom has no canvas/WebGL: getContext() -> null, so hasWebGL() is false and
   every <Stage> renders its static fallback (which is what we want to assert). */
Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
  writable: true,
  value: () => null,
});
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

beforeEach(() => {
  resetApi();
  installFakeFetch();
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
});

afterEach(() => {
  cleanup();
});
