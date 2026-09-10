import { Component, Suspense, useMemo, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { hasWebGL, useInView, useMotionMode } from './sceneUtils.js';

class CanvasBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('[3d] canvas failed, showing static art:', error?.message);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Every 3D surface in the app goes through this gate:
 *   • WebGL probe + error boundary  → a driver problem shows art, not a crash
 *   • "3D" switch + prefers-reduced-motion → static poster fallback
 *   • IntersectionObserver          → off-screen canvases cost nothing
 */
export default function CanvasGate({
  children,
  fallback = null,
  camera = { position: [0, 0.8, 5.4], fov: 45 },
  dpr = [1, 1.6],
  shadows = false,
  className,
  style,
  ...rest
}) {
  const { enabled } = useMotionMode();
  const hostRef = useRef(null);
  const inView = useInView(hostRef);
  const webgl = useMemo(() => hasWebGL(), []);
  const live = enabled && webgl && inView;

  return (
    <div
      ref={hostRef}
      className={className}
      data-3d={live ? 'live' : 'static'}
      style={{ position: 'relative', width: '100%', height: '100%', ...style }}
    >
      {live ? (
        <CanvasBoundary fallback={fallback}>
          <Canvas
            dpr={dpr}
            shadows={shadows}
            camera={camera}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
            frameloop={enabled ? 'always' : 'demand'}
            {...rest}
          >
            <Suspense fallback={null}>{children}</Suspense>
          </Canvas>
        </CanvasBoundary>
      ) : (
        fallback
      )}
    </div>
  );
}
