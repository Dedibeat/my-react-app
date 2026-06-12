import { useState, useEffect, useRef } from 'react';
import './FeedbackModal.css';

const CATEGORIES = [
  { id: 'wrong-tags', label: 'Wrong tags' },
  { id: 'wrong-importance', label: 'Wrong importance' },
  { id: 'broken-link', label: 'Broken link' },
  { id: 'great-problem', label: 'Great problem' },
  { id: 'other', label: 'Other' },
];

const MAX_COMMENT = 500;

export default function FeedbackModal({ problem, existing, onSubmit, onDelete, onError, onClose }) {
  const [category, setCategory] = useState(existing?.category || null);
  const [comment, setComment] = useState(existing?.comment || '');
  const [sending, setSending] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    const selected = cardRef.current?.querySelector('.chip-on') ||
      cardRef.current?.querySelector('.chip');
    selected?.focus();
  }, []);

  function onKeyDown(e) {
    if (e.key === 'Escape' && !sending) {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const focusables = cardRef.current.querySelectorAll('button, textarea');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  async function run(action) {
    setSending(true);
    try {
      await action();
    } catch (err) {
      onError(err);
      setSending(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}
    >
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fb-title"
        ref={cardRef}
        onKeyDown={onKeyDown}
      >
        <div>
          <h2 className="modal-title" id="fb-title">Feedback</h2>
          <p className="modal-subtitle">{problem.name} · {problem.contest}</p>
        </div>
        <div className="chip-row" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={category === c.id}
              className={`chip ${category === c.id ? 'chip-on' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Comment <em className="muted">(optional)</em></span>
          <textarea
            value={comment}
            maxLength={MAX_COMMENT}
            rows={4}
            placeholder="Tell us more…"
            onChange={(e) => setComment(e.target.value)}
          />
          <span className={`char-count ${comment.length > MAX_COMMENT - 50 ? 'near-cap' : ''}`}>
            {comment.length}/{MAX_COMMENT}
          </span>
        </label>
        <div className="modal-actions">
          {existing && (
            <button
              type="button"
              className="btn btn-danger-ghost"
              disabled={sending}
              onClick={() => run(onDelete)}
            >
              Delete
            </button>
          )}
          <span className="modal-spacer" />
          <button type="button" className="btn" disabled={sending} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!category || sending}
            onClick={() => run(() => onSubmit(category, comment))}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
