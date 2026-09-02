import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { Camera, Send, X } from 'lucide-react';
import { type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type RefObject, useEffect, useRef } from 'react';

export interface ComposerPanelProps {
  pendingScreenshots: string[];
  fileInputRef: RefObject<HTMLInputElement | null>;
  question: string;
  variants: Variants;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  onRemoveScreenshot: (index: number) => void;
  onOpenFilePicker: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
}

export function ComposerPanel({
  pendingScreenshots,
  fileInputRef,
  question,
  variants,
  onPaste,
  onRemoveScreenshot,
  onOpenFilePicker,
  onFileInputChange,
  onQuestionChange,
  onSubmit,
}: ComposerPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resize the textarea to fit its content every time `question` changes.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [question]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Submit on Enter without Shift; allow Shift+Enter for newlines.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="sp-paste-zone" onPaste={onPaste}>
      <AnimatePresence>
        {pendingScreenshots.length > 0 ? (
          <motion.div
            key="screenshot-preview"
            className="sp-screenshot-strip"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {pendingScreenshots.map((url, index) => (
              <div key={index} className="sp-screenshot-thumb">
                <img src={url} alt={`Screenshot ${index + 1}`} />
                <button
                  type="button"
                  className="sp-screenshot-remove"
                  aria-label="Remove screenshot"
                  onClick={() => onRemoveScreenshot(index)}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div className="sp-composer" variants={variants}>
        <button
          type="button"
          className="sp-camera-btn"
          aria-label="Attach screenshot"
          title="Attach image (or paste with Ctrl+V)"
          onClick={onOpenFilePicker}
          data-active={pendingScreenshots.length > 0}
        >
          <Camera size={17} strokeWidth={2} />
          {pendingScreenshots.length > 0 ? <span className="sp-camera-badge">{pendingScreenshots.length}</span> : null}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
          onChange={onFileInputChange}
        />
        <textarea
          ref={textareaRef}
          className="sp-composer-textarea"
          value={question}
          placeholder="Ask a question or paste an image…"
          aria-label="Ask a question"
          rows={1}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="sp-send"
          aria-label="Send question"
          onClick={onSubmit}
          disabled={!question.trim() && pendingScreenshots.length === 0}
        >
          <Send size={17} strokeWidth={2} fill="currentColor" />
        </button>
      </motion.div>
    </div>
  );
}
