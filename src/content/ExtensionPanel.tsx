import { AnimatePresence, motion } from 'framer-motion';
import { BookmarkCheck, Camera, Check, ExternalLink, Minus, MoreVertical, Pin } from 'lucide-react';
import type { PointerEventHandler, ReactNode } from 'react';
import { MenuItem, SparkleLogo } from './PanelComponents';

export interface ExtensionPanelProps {
  panelSize: { w: number; h: number } | null;
  isPinned: boolean;
  menuOpen: boolean;
  isSaving: boolean;
  personality: string;
  streak: number;
  isDragging: boolean;
  onHeaderPointerDown: PointerEventHandler<HTMLElement>;
  onHeaderPointerMove: PointerEventHandler<HTMLElement>;
  onHeaderPointerUp: PointerEventHandler<HTMLElement>;
  onMinimize: () => void;
  onTogglePinned: () => void;
  onToggleMenu: () => void;
  onCapture: () => void;
  onSave: () => void;
  onOpenDashboard: () => void;
  onPersonalityChange: (personality: string) => void;
  children: ReactNode;
}

const PERSONALITIES = ['Default', 'Strict Tutor', 'Supportive Friend', 'Socratic Guide', 'Gen Z'];

export function ExtensionPanel({
  panelSize,
  isPinned,
  menuOpen,
  isSaving,
  personality,
  streak,
  isDragging,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
  onMinimize,
  onTogglePinned,
  onToggleMenu,
  onCapture,
  onSave,
  onOpenDashboard,
  onPersonalityChange,
  children,
}: ExtensionPanelProps) {
  return (
    <motion.section
      className="sp-panel"
      role="dialog"
      aria-label="Study Pilot"
      style={panelSize ? { width: panelSize.w, height: panelSize.h } : undefined}
      initial={{ opacity: 0, y: 26, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 18, scale: 0.98 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
    >
      <header
        className="sp-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        data-dragging={isDragging}
      >
        <div className="sp-brand">
          <SparkleLogo size={30} />
          <strong>Study Pilot</strong>
          {streak > 0 && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                background: 'linear-gradient(135deg,#f97316,#ef4444)',
                color: '#fff',
                borderRadius: '99px',
                padding: '1px 7px',
                marginLeft: '4px',
                letterSpacing: '0.02em',
              }}
            >
              🔥 {streak}d
            </span>
          )}
        </div>
        <div className="sp-header-actions">
          <button type="button" className="sp-icon-button" aria-label="Minimize" title="Minimize" onClick={onMinimize}>
            <Minus size={18} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="sp-icon-button"
            data-active={isPinned}
            aria-label={isPinned ? 'Unpin Study Pilot' : 'Pin Study Pilot'}
            aria-pressed={isPinned}
            onClick={onTogglePinned}
          >
            <Pin size={19} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="sp-icon-button"
            aria-label="More options"
            aria-expanded={menuOpen}
            onClick={onToggleMenu}
          >
            <MoreVertical size={20} strokeWidth={2} />
          </button>
        </div>

        <AnimatePresence>
          {menuOpen ? (
            <>
              <button type="button" className="sp-menu-backdrop" aria-label="Close menu" onClick={onToggleMenu} />
              <motion.div
                className="sp-menu"
                role="menu"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.14 }}
              >
                <MenuItem
                  icon={<Camera size={16} />}
                  label="Capture tab screenshot"
                  onClick={() => {
                    onToggleMenu();
                    onCapture();
                  }}
                />
                <MenuItem
                  icon={<BookmarkCheck size={16} />}
                  label={isSaving ? 'Saving…' : 'Save to dashboard'}
                  onClick={() => {
                    onToggleMenu();
                    onSave();
                  }}
                />
                <MenuItem
                  icon={<ExternalLink size={16} />}
                  label="Open dashboard"
                  onClick={() => {
                    onToggleMenu();
                    onOpenDashboard();
                  }}
                />

                <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
                <div
                  style={{
                    padding: '6px 12px',
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  AI Personality
                </div>
                {PERSONALITIES.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className="sp-menu-item"
                    onClick={() => {
                      onPersonalityChange(candidate);
                      onToggleMenu();
                    }}
                  >
                    <span className="sp-menu-item-icon">
                      {personality === candidate ? <Check size={16} color="#10b981" /> : <span style={{ width: 16 }} />}
                    </span>
                    {candidate}
                  </button>
                ))}
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </header>
      {children}
    </motion.section>
  );
}
