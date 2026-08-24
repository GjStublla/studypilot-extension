import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Check, ChevronDown, Copy, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { FlashcardViewer, QuizViewer, type StructuredCard } from './PanelComponents';
import type { StudyAction } from '@/shared/types';

export interface AnswerCardData {
  title: string;
  body: string;
  action?: StudyAction;
}

export type AnswerFeedback = 'up' | 'down' | null;

export interface AnswerCardPanelProps {
  card: AnswerCardData;
  cardOpen: boolean;
  structuredCard: StructuredCard;
  screenshotDataUrl: string | null;
  isSpeaking: boolean;
  copied: boolean;
  feedback: AnswerFeedback;
  thinking: boolean;
  onToggleOpen: () => void;
  onSpeak: () => void;
  onCopy: () => void | Promise<void>;
  onFeedback: (value: Exclude<AnswerFeedback, null>) => void;
}

const answerCardReveal = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export function AnswerCardPanel({
  card,
  cardOpen,
  structuredCard,
  screenshotDataUrl,
  isSpeaking,
  copied,
  feedback,
  thinking,
  onToggleOpen,
  onSpeak,
  onCopy,
  onFeedback,
}: AnswerCardPanelProps) {
  return (
    <motion.section className="sp-card" variants={answerCardReveal} data-thinking={thinking}>
      <button type="button" className="sp-card-head" aria-expanded={cardOpen} onClick={onToggleOpen}>
        <strong>{card.title}</strong>
        <span className="sp-card-time">Just now</span>
        <ChevronDown size={20} className="sp-card-chevron" data-open={cardOpen} aria-hidden="true" />
      </button>

      <AnimatePresence initial={false}>
        {cardOpen ? (
          <motion.div
            key="card-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {structuredCard?.type === 'flashcards' ? (
              <FlashcardViewer items={structuredCard.items} />
            ) : structuredCard?.type === 'quiz' ? (
              <QuizViewer items={structuredCard.items} />
            ) : (
              <p className="sp-card-body">{renderMarkdown(card.body)}</p>
            )}
            {screenshotDataUrl ? (
              <figure className="sp-card-screenshot">
                <img src={screenshotDataUrl} alt="Screenshot shared with StudyPilot" />
                <figcaption>
                  <Camera size={13} />
                  <span>Screenshot shared</span>
                </figcaption>
              </figure>
            ) : null}
            <div className="sp-card-actions">
              <button
                type="button"
                aria-label={isSpeaking ? 'Stop reading aloud' : 'Read aloud'}
                data-active={isSpeaking}
                onClick={onSpeak}
              >
                <Volume2 size={19} />
              </button>
              <button type="button" aria-label="Copy answer" onClick={() => void onCopy()}>
                {copied ? <Check size={19} /> : <Copy size={19} />}
              </button>
              <span className="sp-card-spacer" />
              <button
                type="button"
                aria-label="Helpful"
                data-feedback="up"
                data-active={feedback === 'up'}
                onClick={() => onFeedback('up')}
              >
                <ThumbsUp size={19} />
              </button>
              <button
                type="button"
                aria-label="Not helpful"
                data-feedback="down"
                data-active={feedback === 'down'}
                onClick={() => onFeedback('down')}
              >
                <ThumbsDown size={19} />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.section>
  );
}

function renderMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = text.split('\n');

  lines.forEach((line, lineIdx) => {
    if (lineIdx > 0) nodes.push(<br key={`br${lineIdx}`} />);

    const re = /(\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(line)) !== null) {
      if (match.index > cursor) nodes.push(line.slice(cursor, match.index));

      if (match[0].startsWith('**')) {
        nodes.push(<strong key={`b${lineIdx}-${match.index}`}>{match[2]}</strong>);
      } else {
        nodes.push(<em key={`i${lineIdx}-${match.index}`}>{match[3]}</em>);
      }
      cursor = match.index + match[0].length;
    }

    if (cursor < line.length) nodes.push(line.slice(cursor));
  });

  return nodes;
}
