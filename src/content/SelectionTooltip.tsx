import { AnimatePresence, motion } from 'framer-motion';
import { HelpCircle, Layers, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SelectionTooltipData {
  top: number;
  left: number;
  text: string;
  placeBelow?: boolean;
}

export interface SelectionTooltipProps {
  panelOpen: boolean;
  selection: SelectionTooltipData | null;
  onExplain: (text: string) => void;
  onFlashcard: (text: string) => void;
  onQuiz: (text: string) => void;
}

export function SelectionTooltip({ panelOpen, selection, onExplain, onFlashcard, onQuiz }: SelectionTooltipProps) {
  return (
    <AnimatePresence>
      {selection && !panelOpen ? (
        <motion.div
          className="sp-selection-tooltip"
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          initial={{ opacity: 0, y: selection.placeBelow ? -8 : 8, scale: 0.93 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: selection.placeBelow ? -4 : 4, scale: 0.95 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: 'fixed',
            top: selection.top,
            left: selection.left,
            zIndex: 2147483647,
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            padding: '5px 6px',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
            borderRadius: '10px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <span
            style={{
              position: 'absolute',
              ...(selection.placeBelow
                ? { top: -6, borderBottom: '6px solid #16213e', borderTop: 'none' }
                : { bottom: -6, borderTop: '6px solid #16213e', borderBottom: 'none' }),
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))',
            }}
          />
          <TooltipAction
            label="Explain"
            icon={<Lightbulb size={13} strokeWidth={2} />}
            color="#f59e0b"
            onClick={() => onExplain(selection.text)}
          />
          <TooltipAction
            label="Flashcard"
            icon={<Layers size={13} strokeWidth={2} />}
            color="#8b5cf6"
            onClick={() => onFlashcard(selection.text)}
          />
          <TooltipAction
            label="Quiz Me"
            icon={<HelpCircle size={13} strokeWidth={2} />}
            color="#10b981"
            onClick={() => onQuiz(selection.text)}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function TooltipAction({
  label,
  icon,
  color,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '5px 9px',
        borderRadius: '7px',
        border: 'none',
        background: 'transparent',
        color: '#e2e8f0',
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'background 0.15s ease',
        whiteSpace: 'nowrap',
        letterSpacing: '0.01em',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = 'rgba(255,255,255,0.1)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ color }}>{icon}</span>
      {label}
    </button>
  );
}
