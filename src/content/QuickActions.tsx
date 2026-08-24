import { BookmarkCheck, Timer, X } from 'lucide-react';
import type { DashboardSessionSummary, SharedChatContext, StudyAction } from '@/shared/types';
import { ExplainGlyph, FlashcardsGlyph, QuizGlyph, QuickChip, SummarizeGlyph } from './PanelComponents';

export interface QuickActionsProps {
  sharedContext: SharedChatContext | null;
  pomodoroRemaining: number | null;
  formatTime: (seconds: number) => string;
  onRunStudyAction: (action: StudyAction) => void;
  onOpenStudyMode: (mode: 'quiz' | 'flashcards') => void;
  onContinueSession: (session: DashboardSessionSummary) => void;
  onStopPomodoro: () => void;
  onTogglePomodoroPicker: () => void;
}

export function QuickActions({
  sharedContext,
  pomodoroRemaining,
  formatTime,
  onRunStudyAction,
  onOpenStudyMode,
  onContinueSession,
  onStopPomodoro,
  onTogglePomodoroPicker,
}: QuickActionsProps) {
  return (
    <>
      <QuickChip label="Summarize" onClick={() => onRunStudyAction('summarize')}>
        <SummarizeGlyph />
      </QuickChip>
      <QuickChip label="Explain" onClick={() => onRunStudyAction('explain')}>
        <ExplainGlyph />
      </QuickChip>
      <QuickChip label="Quiz Me" onClick={() => onOpenStudyMode('quiz')}>
        <QuizGlyph />
      </QuickChip>
      <QuickChip label="Flashcards" onClick={() => onOpenStudyMode('flashcards')}>
        <FlashcardsGlyph />
      </QuickChip>
      {sharedContext?.sessions[0] ? (
        <QuickChip label="Continue session" onClick={() => onContinueSession(sharedContext.sessions[0])}>
          <BookmarkCheck size={14} strokeWidth={2.2} />
        </QuickChip>
      ) : null}
      {pomodoroRemaining !== null ? (
        <QuickChip label={`⏱ ${formatTime(pomodoroRemaining)}`} onClick={onStopPomodoro}>
          <span
            className="sp-chip-icon"
            aria-hidden="true"
            style={{
              background: 'linear-gradient(135deg,#f97316,#ef4444)',
              borderRadius: '50%',
              width: 20,
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={12} strokeWidth={2.5} color="#fff" />
          </span>
        </QuickChip>
      ) : (
        <QuickChip label="Focus" onClick={onTogglePomodoroPicker}>
          <span className="sp-chip-icon sp-chip-icon--blue" aria-hidden="true">
            <Timer size={14} strokeWidth={2.2} />
          </span>
        </QuickChip>
      )}
    </>
  );
}
