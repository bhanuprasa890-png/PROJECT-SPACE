import { useEffect, useMemo, useState } from 'react';

let supported;

/** One cheap probe per page load — no point mounting WebGL if the GPU is blocked. */
export function hasWebGL() {
  if (supported !== undefined) return supported;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    supported = Boolean(gl);
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
  } catch {
    supported = false;
  }
  return supported;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches));
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return undefined;
    const onChange = (event) => setReduced(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

const STORE_KEY = 'mise:3d';

/** App-level 3D switch (persisted) combined with the OS motion preference. */
export function useMotionMode() {
  const reduced = useReducedMotion();
  const [pref, setPrefState] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) ?? 'auto' : 'auto'));

  const enabled = pref === 'on' || (pref === 'auto' && !reduced);
  const effective = enabled ? 'on' : 'off';

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.dataset.motion = effective;
  }, [effective]);

  const setPref = (value) => {
    setPrefState(value);
    try {
      localStorage.setItem(STORE_KEY, value);
    } catch {
      /* private mode: keep the in-memory value */
    }
  };

  const cycle = () => setPref(pref === 'auto' ? 'on' : pref === 'on' ? 'off' : 'auto');

  const label = useMemo(() => {
    if (pref === 'auto') return reduced ? 'Auto · off' : 'Auto · on';
    return pref === 'on' ? '3D on' : '3D off';
  }, [pref, reduced]);

  return { enabled, pref, setPref, cycle, label, reduced };
}

/** Mount children only while the element is near the viewport. */
export function useInView(ref, { rootMargin = '220px' } = {}) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return inView;
}
