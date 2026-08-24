import { AnimatePresence, motion } from 'framer-motion';

export interface PomodoroPickerProps {
  open: boolean;
  remainingSeconds: number | null;
  stats: Record<string, number>;
  onStart: (minutes: number) => void;
}

/**
 * Focus-duration picker and its compact weekly progress visualization.
 * Keeping this state-free makes the parent responsible only for the timer
 * lifecycle while this component owns the presentation boundary.
 */
export function PomodoroPicker({
  open,
  remainingSeconds,
  stats,
  onStart,
}: PomodoroPickerProps) {
  return (
    <AnimatePresence>
      {open && remainingSeconds === null ? (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          style={{
            display: 'flex',
            gap: '6px',
            padding: '6px 14px 10px',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500, width: '100%', textAlign: 'center', marginBottom: '2px' }}>
            🎯 Pick your focus time
          </span>
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', width: '100%', marginBottom: '8px' }}>
            {[5, 15, 25, 45, 60].map(minutes => (
              <button
                key={minutes}
                type="button"
                onClick={() => onStart(minutes)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(99,102,241,0.25)',
                  background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))',
                  color: '#818cf8',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={event => {
                  event.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(139,92,246,0.2))';
                  event.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)';
                  event.currentTarget.style.transform = 'scale(1.05)';
                }}
                onMouseLeave={event => {
                  event.currentTarget.style.background = 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.08))';
                  event.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)';
                  event.currentTarget.style.transform = 'scale(1)';
                }}
              >
                {minutes}m
              </button>
            ))}
          </div>

          <div style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Weekly Progress</span>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '40px' }}>
              {Array.from({ length: 7 }).map((_, index) => {
                const date = new Date();
                date.setDate(date.getDate() - (6 - index));
                const dateKey = date.toISOString().split('T')[0];
                const minutes = stats[dateKey] || 0;
                const maxMinutes = Math.max(...Object.values(stats), 60);
                const heightPercent = Math.max(4, (minutes / maxMinutes) * 100);
                const isToday = index === 6;
                return (
                  <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                    <div style={{ width: '14px', height: '40px', display: 'flex', alignItems: 'flex-end', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: '100%', height: `${heightPercent}%`, background: isToday ? 'linear-gradient(to top, #8b5cf6, #3b82f6)' : '#475569', borderRadius: '3px', transition: 'height 0.3s ease' }} title={`${minutes} min`} />
                    </div>
                    <span style={{ fontSize: '9px', color: isToday ? '#8b5cf6' : '#64748b', fontWeight: isToday ? 700 : 500 }}>
                      {['S', 'M', 'T', 'W', 'T', 'F', 'S'][date.getDay()]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
