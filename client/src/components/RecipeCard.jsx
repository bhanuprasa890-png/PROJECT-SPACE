import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useMotionMode } from '../three/sceneUtils.js';

const DIFFICULTY = {
  Easy: { dots: 1, tone: 'var(--color-accent-herb)' },
  Medium: { dots: 2, tone: 'var(--color-accent-saffron-soft)' },
  Tricky: { dots: 3, tone: 'var(--color-accent-chilli)' },
};

function Heart({ filled }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 20s-7.2-4.5-9.2-9A5.2 5.2 0 0112 6.5 5.2 5.2 0 0121.2 11c-2 4.5-9.2 9-9.2 9z" />
    </svg>
  );
}

/**
 * Recipe card. The 3D is real CSS perspective (rotateX/rotateY + translateZ
 * on layered children) rather than a WebGL canvas: 12 canvases would burn the
 * GPU, and layered parallax reads better per card anyway.
 */
export default function RecipeCard({ recipe, index = 0, onToggleFavorite, matchScore }) {
  const ref = useRef(null);
  const navigate = useNavigate();
  const { enabled } = useMotionMode();
  const difficulty = DIFFICULTY[recipe.difficulty] ?? DIFFICULTY.Medium;

  function onMove(event) {
    const node = ref.current;
    if (!node || !enabled) return;
    const rect = node.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const tiltX = (py - 0.5) * -9;
    const tiltY = (px - 0.5) * 11;
    node.style.transform = `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateZ(18px) scale(1.012)`;
    node.style.setProperty('--mx', `${px * 100}%`);
    node.style.setProperty('--my', `${py * 100}%`);
  }

  function onLeave() {
    const node = ref.current;
    if (!node) return;
    node.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0deg) scale(1)';
    node.style.setProperty('--mx', '50%');
    node.style.setProperty('--my', '0%');
  }

  return (
    <motion.article
      ref={ref}
      className="rcard"
      role="link"
      tabIndex={0}
      aria-label={`${recipe.title} — ${recipe.minutes} minutes, ${recipe.difficulty}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onClick={() => navigate(`/recipes/${recipe.id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          navigate(`/recipes/${recipe.id}`);
        }
      }}
      style={{
        '--rcard-accent': recipe.palette?.[0] ?? '#FF8A3D',
        '--rcard-accent-2': recipe.palette?.[1] ?? '#FFD28A',
        transition: 'transform var(--motion-duration-base) var(--motion-easing-out), box-shadow var(--motion-duration-base)',
      }}
      initial={{ opacity: 0, y: 30, rotateX: -10 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay: Math.min(index, 8) * 0.045, ease: [0.16, 0.84, 0.24, 1] }}
    >
      {recipe.cookedAt ? <span className="rcard__done">Cooked {new Date(recipe.cookedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> : null}

      <div className="rcard__media">
        <span className="rcard__emoji">{recipe.emoji}</span>
        <span className="rcard__steam" />
      </div>

      <button
        type="button"
        className="rcard__fav"
        aria-label={recipe.favorite ? 'Remove from favourites' : 'Add to favourites'}
        aria-pressed={recipe.favorite}
        data-on={recipe.favorite}
        onClick={(event) => {
          event.stopPropagation();
          onToggleFavorite?.(recipe);
        }}
      >
        <Heart filled={recipe.favorite} />
      </button>

      <div>
        <h3 className="rcard__title">{recipe.title}</h3>
        <p className="rcard__tag">{recipe.tagline}</p>
      </div>

      <div className="rcard__meta">
        <span className="mono">{recipe.cuisine}</span>
        <span aria-hidden="true">·</span>
        <span className="mono">⏱ {recipe.minutes} min</span>
        <span aria-hidden="true">·</span>
        <span title={`${difficulty.dots} of 3 difficulty`}>
          <span style={{ color: difficulty.tone, letterSpacing: 2 }}>{'●'.repeat(difficulty.dots)}</span>
          <span className="dim">{` ${recipe.difficulty}`}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span className="mono">{recipe.kcal} kcal</span>
      </div>

      {typeof matchScore === 'number' ? (
        <div className="rcard__bar" title={`${Math.round(matchScore * 100)}% of the pantry covered`}>
          <i style={{ width: `${Math.max(6, Math.round(matchScore * 100))}%` }} />
        </div>
      ) : null}

      <div className="rcard__foot">
        <span className="rcard__steps">
          {recipe.stepCount} steps · serves {recipe.servings}
        </span>
        <span className="rcard__steps" style={{ color: 'var(--color-ink-accent)' }}>
          Cook it →
        </span>
      </div>
    </motion.article>
  );
}
