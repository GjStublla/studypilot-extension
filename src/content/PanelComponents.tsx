import { AnimatePresence, motion } from 'framer-motion';
import { AlignLeft, HelpCircle, Layers, Lightbulb } from 'lucide-react';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';

export interface FlashcardItem {
  q: string;
  a: string;
}

export interface QuizItem {
  question: string;
  options: string[];
  answer: number;
}

export type StructuredCard =
  { type: 'flashcards'; items: FlashcardItem[] } | { type: 'quiz'; items: QuizItem[] } | null;

export type OrbState = 'listening' | 'muted' | 'paused' | 'thinking';

// ─── FlashcardViewer ──────────────────────────────────────────────────────────

export function FlashcardViewer({ items }: { items: FlashcardItem[] }) {
  const [index, setIndex] = useState(0);
  const [side, setSide] = useState<'q' | 'a'>('q');
  const [dir, setDir] = useState(0); // +1 forward, -1 back, 0 flip

  function go(delta: number) {
    setDir(delta);
    setIndex((i) => (i + delta + items.length) % items.length);
    setSide('q');
  }

  function flip() {
    setDir(0);
    setSide((s) => (s === 'q' ? 'a' : 'q'));
  }

  // Keyboard: Space/Enter = flip, ArrowLeft/Right = navigate
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      flip();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
  }

  const card = items[index];
  if (!card) return null;
  const isAnswer = side === 'a';
  const pct = Math.round(((index + 1) / items.length) * 100);

  return (
    <div className="sp-fc-wrap">
      {/* progress + counter */}
      <div className="sp-fc-header">
        <span className="sp-fc-counter">
          {index + 1} / {items.length}
        </span>
        <span className="sp-fc-pct">{pct}%</span>
      </div>
      <div className="sp-fc-progress">
        <div className="sp-fc-progress-bar" style={{ width: `${pct}%` }} />
      </div>

      {/* card */}
      <div
        className="sp-fc-card"
        data-side={side}
        role="button"
        tabIndex={0}
        aria-label={isAnswer ? 'Answer — press Space to flip' : 'Question — press Space to reveal answer'}
        onClick={flip}
        onKeyDown={handleKey}
      >
        {/* side badge */}
        <div className="sp-fc-badge" data-side={side}>
          {isAnswer ? 'Answer' : 'Question'}
        </div>

        {/* animated content */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={`${index}-${side}`}
            className="sp-fc-text"
            initial={{ opacity: 0, y: dir === 0 ? 10 : dir > 0 ? 18 : -18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: dir === 0 ? -8 : dir > 0 ? -18 : 18 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {isAnswer ? card.a : card.q}
          </motion.p>
        </AnimatePresence>

        <span className="sp-fc-hint">{isAnswer ? 'Space to flip back' : 'Space to reveal · ← → to navigate'}</span>
      </div>

      {/* nav */}
      <div className="sp-fc-nav">
        <button type="button" className="sp-fc-nav-btn" aria-label="Previous card" onClick={() => go(-1)}>
          ← Prev
        </button>
        <div className="sp-fc-dots">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              className="sp-fc-dot"
              data-active={i === index}
              aria-label={`Card ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                setDir(i > index ? 1 : -1);
                setIndex(i);
                setSide('q');
              }}
            />
          ))}
        </div>
        <button type="button" className="sp-fc-nav-btn" aria-label="Next card" onClick={() => go(1)}>
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── QuizViewer ───────────────────────────────────────────────────────────────

export function QuizViewer({ items, onPerfectScore }: { items: QuizItem[]; onPerfectScore?: () => void }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [scores, setScores] = useState<boolean[]>([]);
  const [done, setDone] = useState(false);

  const q = items[index];
  const isAnswered = selected !== null;
  const isCorrect = selected === q?.answer;

  function choose(optIdx: number) {
    if (isAnswered) return;
    setSelected(optIdx);
    setScores((prev) => [...prev, optIdx === q?.answer]);
  }

  function next() {
    if (index + 1 >= items.length) {
      setDone(true);
    } else {
      setIndex((i) => i + 1);
      setSelected(null);
    }
  }

  function restart() {
    setIndex(0);
    setSelected(null);
    setScores([]);
    setDone(false);
  }

  if (done) {
    const correct = scores.filter(Boolean).length;
    const pct = Math.round((correct / items.length) * 100);
    if (pct === 100) onPerfectScore?.();
    return (
      <div className="sp-quiz-result">
        <span className="sp-quiz-result-score" data-pass={pct >= 60}>
          {pct}%
        </span>
        <p className="sp-quiz-result-label">
          {correct} / {items.length} correct
        </p>
        <p className="sp-quiz-result-msg">
          {pct === 100
            ? 'Perfect score! 🎉'
            : pct >= 80
              ? 'Great work!'
              : pct >= 60
                ? 'Solid effort — review the ones you missed.'
                : "Keep studying — you'll get there!"}
        </p>
        <button type="button" className="sp-quiz-retry" onClick={restart}>
          Try again
        </button>
      </div>
    );
  }

  if (!q) return null;

  return (
    <div className="sp-quiz-wrap">
      <p className="sp-quiz-counter">
        {index + 1} / {items.length}
      </p>
      <p className="sp-quiz-question">{q.question}</p>
      <div className="sp-quiz-options">
        {q.options.map((opt, i) => (
          <button
            key={i}
            type="button"
            className="sp-quiz-option"
            data-state={!isAnswered ? 'idle' : i === q.answer ? 'correct' : i === selected ? 'wrong' : 'idle'}
            disabled={isAnswered}
            onClick={() => choose(i)}
          >
            <span className="sp-quiz-opt-letter">{String.fromCharCode(65 + i)}</span>
            <span className="sp-quiz-opt-text">{opt.replace(/^[A-D]\)\s*/i, '')}</span>
          </button>
        ))}
      </div>
      {isAnswered ? (
        <div className="sp-quiz-feedback">
          <span data-correct={isCorrect}>
            {isCorrect ? '✓ Correct!' : `✗ The answer was ${String.fromCharCode(65 + q.answer)}`}
          </span>
          <button type="button" className="sp-quiz-next" onClick={next}>
            {index + 1 >= items.length ? 'See results' : 'Next →'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Orb({ state }: { state: OrbState }) {
  return (
    <div className="sp-orb" data-state={state} aria-hidden="true">
      <span className="sp-orb-ripples" />
      <span className="sp-orb-bloom sp-orb-bloom--violet" />
      <span className="sp-orb-bloom sp-orb-bloom--blue" />
      <span className="sp-orb-halo" />
      <span className="sp-orb-ring" />
      <span className="sp-orb-nebula" />
      <span className="sp-orb-core" />
      <span className="sp-orb-wave">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

export function RoundButton({
  active,
  disabled = false,
  tinted = false,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  tinted?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="sp-round"
      data-active={active}
      data-tinted={tinted}
      disabled={disabled}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className="sp-menu-item" role="menuitem" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function QuickChip({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="sp-chip" onClick={onClick}>
      {children}
      <span>{label}</span>
    </button>
  );
}

export function SparkleLogo({ size = 28 }: { size?: number }) {
  const gradientId = useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <svg width={size} height={size} viewBox="0 0 44 44" fill="none" aria-hidden="true" className="sp-logo">
      <defs>
        <linearGradient id={`sp-spark-${gradientId}`} x1="8" y1="4" x2="38" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8fdcff" />
          <stop offset="0.52" stopColor="#38a1ff" />
          <stop offset="1" stopColor="#2e5bff" />
        </linearGradient>
      </defs>
      <path
        d="M26.5 2.5c.78 10.5 5.22 14.94 15.72 15.72-10.5.78-14.94 5.22-15.72 15.72-.78-10.5-5.22-14.94-15.72-15.72C21.28 17.44 25.72 13 26.5 2.5Z"
        fill={`url(#sp-spark-${gradientId})`}
      />
      <path
        d="M11.5 28c.42 5.55 2.78 7.91 8.33 8.33-5.55.42-7.91 2.78-8.33 8.33-.42-5.55-2.78-7.91-8.33-8.33 5.55-.42 7.91-2.78 8.33-8.33Z"
        fill={`url(#sp-spark-${gradientId})`}
      />
    </svg>
  );
}

export function SummarizeGlyph() {
  return (
    <span className="sp-chip-icon sp-chip-icon--blue" aria-hidden="true">
      <AlignLeft size={14} strokeWidth={2.2} />
    </span>
  );
}

export function ExplainGlyph() {
  return (
    <span className="sp-chip-icon sp-chip-icon--amber" aria-hidden="true">
      <Lightbulb size={14} strokeWidth={2.2} />
    </span>
  );
}

export function QuizGlyph() {
  return (
    <span className="sp-chip-icon sp-chip-icon--green" aria-hidden="true">
      <HelpCircle size={14} strokeWidth={2.2} />
    </span>
  );
}

export function FlashcardsGlyph() {
  return (
    <span className="sp-chip-icon sp-chip-icon--violet" aria-hidden="true">
      <Layers size={14} strokeWidth={2.2} />
    </span>
  );
}
