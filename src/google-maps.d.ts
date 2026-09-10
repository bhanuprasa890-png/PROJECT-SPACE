/**
 * Ambient declaration so the loaded SDK is reachable as `window.google`.
 * The Maps JavaScript API assigns the global itself; this only teaches
 * TypeScript about it (types come from `@types/google.maps`).
 */
declare global {
  interface Window {
    google: typeof google;
  }
}

export {};
