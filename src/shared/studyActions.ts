import type { StudyAction } from './types';

export function titleForAction(action: StudyAction, question?: string): string {
  if (question?.trim()) return titleFromQuestion(question);

  switch (action) {
    case 'summarize':
      return 'Page summary';
    case 'quiz':
      return 'Quick quiz';
    case 'flashcards':
      return 'Flashcards';
    case 'explain':
    default:
      return 'StudyPilot coaching';
  }
}

export function defaultPromptForAction(action: StudyAction): string {
  switch (action) {
    case 'summarize':
      return 'Summarize this study material.';
    case 'quiz':
      return 'Quiz me on this study material.';
    case 'flashcards':
      return 'Create flashcards from this study material.';
    case 'explain':
    default:
      return 'Explain the current study material.';
  }
}

export function titleFromQuestion(question: string): string {
  const clean = question.replace(/[?!.]+$/, '').trim();
  const short = clean.length > 44 ? `${clean.slice(0, 44).trimEnd()}...` : clean;
  return short.charAt(0).toUpperCase() + short.slice(1);
}
