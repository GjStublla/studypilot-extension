import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, HelpCircle, Layers } from 'lucide-react';
import { FlashcardViewer, QuizViewer, type StructuredCard } from './PanelComponents';

export type StudyMode = 'flashcards' | 'quiz';

export interface StudyModePanelProps {
  mode: StudyMode;
  loading: boolean;
  error: string | null;
  card: StructuredCard;
  onClose: () => void;
  onRegenerate: (mode: StudyMode) => void;
  onPerfectScore?: () => void;
}

export function StudyModePanel({
  mode,
  loading,
  error,
  card,
  onClose,
  onRegenerate,
  onPerfectScore,
}: StudyModePanelProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={mode}
        className="sp-study-panel"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="sp-study-header">
          <button type="button" className="sp-study-back" aria-label="Back to chat" onClick={onClose}>
            <ArrowLeft size={17} strokeWidth={2} />
            <span>Back</span>
          </button>
          <span className="sp-study-title">
            {mode === 'flashcards' ? (
              <>
                <Layers size={15} strokeWidth={2} /> Flashcards
              </>
            ) : (
              <>
                <HelpCircle size={15} strokeWidth={2} /> Quiz
              </>
            )}
          </span>
          <button
            type="button"
            className="sp-study-reload"
            aria-label="Regenerate"
            title="Generate new set"
            onClick={() => onRegenerate(mode)}
            disabled={loading}
          >
            ↺
          </button>
        </div>

        {loading ? (
          <div className="sp-study-loading">
            <span className="sp-study-spinner" aria-hidden="true" />
            <span>Generating {mode === 'flashcards' ? 'flashcards' : 'quiz'}…</span>
          </div>
        ) : error ? (
          <div className="sp-study-error">
            <p>{error}</p>
            <button type="button" onClick={() => onRegenerate(mode)}>
              Try again
            </button>
          </div>
        ) : card?.type === 'flashcards' ? (
          <FlashcardViewer items={card.items} />
        ) : card?.type === 'quiz' ? (
          <QuizViewer items={card.items} onPerfectScore={onPerfectScore} />
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}
