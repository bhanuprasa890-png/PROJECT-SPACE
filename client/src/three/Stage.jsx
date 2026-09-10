import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { hasWebGL, useMotionMode } from './sceneUtils.js';

/**
 * Public 3D entry point.
 *
 * Nothing in `three/CanvasGate`, `three/KitchenHeroScene`, `three/copilotMeshes`,
 * three.js or drei is in the first-load bundle: this module only imports the
 * cheap probes. The real gate is dynamically imported, and only when WebGL is
 * supported, motion is allowed, and the element exists. That keeps the login
 * page at ~60 kB of app code.
 */
const loadGate = () => import('./CanvasGate.jsx');

export default function Stage({ children, fallback = null, ...canvasProps }) {
  const { enabled } = useMotionMode();
  const webgl = useMemo(() => hasWebGL(), []);
  const live = enabled && webgl;
  const [Gate, setGate] = useState(null);

  useEffect(() => {
    if (!live) {
      setGate(null);
      return undefined;
    }
    let cancelled = false;
    loadGate().then((mod) => {
      if (!cancelled) setGate(() => mod.default);
    });
    return () => {
      cancelled = true;
    };
  }, [live]);

  if (!live || !Gate) return fallback;

  return (
    <Suspense fallback={fallback}>
      <Gate {...canvasProps}>{children}</Gate>
    </Suspense>
  );
}

/** Scene wrappers live here so pages never import three.js statically. */
export const KitchenHeroScene = lazy(() => import('./KitchenHeroScene.jsx').then((m) => ({ default: m.KitchenHeroScene })));
export const CopilotMesh = lazy(() => import('./copilotMeshes.jsx').then((m) => ({ default: m.CopilotMesh })));
