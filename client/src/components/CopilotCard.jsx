import { useRef } from 'react';
import { motion } from 'framer-motion';
import Stage, { CopilotMesh } from '../three/Stage.jsx';
import { useMotionMode } from '../three/sceneUtils.js';

const EMOJI = { sigma: '🔪', manus: '🤲', nova: '🔥', atlas: '🌏', miso: '🫙' };

/**
 * A 3D card: its own WebGL canvas with a procedural character, plus a CSS 3D
 * tilt that follows the pointer. Falls back to a still poster when 3D is off.
 */
export default function CopilotCard({ copilot, index = 0 }) {
  const ref = useRef(null);
  const { enabled } = useMotionMode();

  function onMove(event) {
    const node = ref.current;
    if (!node || !enabled) return;
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    node.style.transform = `perspective(760px) rotateY(${px * 10}deg) rotateX(${-py * 10}deg) translateZ(14px)`;
  }

  function onLeave() {
    if (ref.current) ref.current.style.transform = 'perspective(760px) rotateY(0deg) rotateX(0deg) translateZ(0px)';
  }

  return (
    <motion.article
      ref={ref}
      className="copilot"
      style={{ '--copilot-accent': copilot.accent, transition: 'transform var(--motion-duration-base) var(--motion-easing-out)' }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      initial={{ opacity: 0, y: 26, rotateX: -8 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.55, delay: index * 0.07, ease: [0.16, 0.84, 0.24, 1] }}
    >
      <span className="copilot__stat mono">{copilot.stat}</span>
      <div className="copilot__stage">
        <Stage
          camera={{ position: [0, 0.35, 3.9], fov: 45 }}
          fallback={<div className="copilot__fallback">{EMOJI[copilot.mesh] ?? '🍳'}</div>}
        >
          <CopilotMesh mesh={copilot.mesh} accent={copilot.accent} />
        </Stage>
      </div>
      <h3 className="copilot__name">{copilot.name}</h3>
      <span className="copilot__role">{copilot.role}</span>
      <p className="copilot__blurb">{copilot.blurb}</p>
      <div className="copilot__chips">
        {copilot.strengths.map((strength) => (
          <span className="chip" key={strength}>
            {strength}
          </span>
        ))}
      </div>
      <p className="copilot__move">{copilot.signatureMove}</p>
    </motion.article>
  );
}
