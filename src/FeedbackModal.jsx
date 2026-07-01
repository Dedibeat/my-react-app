import { useState, useEffect, useRef } from 'react';
import './FeedbackModal.css';
import { api } from './api.js';

const CATEGORIES = [
  { id: 'wrong-tags', label: 'Wrong tags' },
  { id: 'wrong-importance', label: 'Wrong importance' },
  { id: 'broken-link', label: 'Broken link' },
  { id: 'great-problem', label: 'Great problem' },
  { id: 'other', label: 'Other' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

const MAX_COMMENT = 500;

export default function FeedbackModal({ problem, existing, isAdmin, onSubmit, onDelete, onError, onClose }) {
  const [category, setCategory] = useState(existing?.category || '');
  const [comment, setComment] = useState(existing?.comment || '');
  const [sending, setSending] = useState(false);
  const [allNotes, setAllNotes] = useState(null); // admin: every user's note on this problem
  const cardRef = useRef(null);

  useEffect(() => {
    const selected = cardRef.current?.querySelector('.chip-on') ||
      cardRef.current?.querySelector('.chip');
    selected?.focus();
  }, []);

  // Admins additionally load all users' notes for this problem.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    api.getAllFeedback(problem.id)
      .then((list) => { if (!cancelled) setAllNotes(list); })
      .catch(() => { if (!cancelled) setAllNotes([]); });
    return () => { cancelled = true; };
  }, [isAdmin, problem.id]);

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

  const canSave = Boolean(category) || comment.trim().length > 0;

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
          <h2 className="modal-title" id="fb-title">Note &amp; feedback</h2>
          <p className="modal-subtitle">{problem.name} · {problem.contest}</p>
        </div>
        <label className="field">
          <span>Your note <em className="muted">(private to you)</em></span>
          <textarea
            value={comment}
            maxLength={MAX_COMMENT}
            rows={4}
            placeholder="A note to yourself, or feedback on this problem…"
            onChange={(e) => setComment(e.target.value)}
          />
          <span className={`char-count ${comment.length > MAX_COMMENT - 50 ? 'near-cap' : ''}`}>
            {comment.length}/{MAX_COMMENT}
          </span>
        </label>
        <div className="field">
          <span>Flag <em className="muted">(optional)</em></span>
          <div className="chip-row" role="group" aria-label="Flag">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={category === c.id}
                className={`chip ${category === c.id ? 'chip-on' : ''}`}
                onClick={() => setCategory(category === c.id ? '' : c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
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
            disabled={!canSave || sending}
            onClick={() => run(() => onSubmit(category, comment))}
          >
            {sending ? 'Saving…' : 'Save'}
          </button>
        </div>

        {isAdmin && (
          <div className="fb-all">
            <h3 className="fb-all-title">All notes {allNotes ? `(${allNotes.length})` : ''}</h3>
            {allNotes === null ? (
              <p className="muted">Loading…</p>
            ) : allNotes.length === 0 ? (
              <p className="muted">No notes from anyone yet.</p>
            ) : (
              <ul className="fb-all-list">
                {allNotes.map((n, i) => (
                  <li key={i} className="fb-all-item">
                    <div className="fb-all-head">
                      <span className="fb-all-user">{n.username}</span>
                      {n.category && <span className="fb-all-cat">{CATEGORY_LABEL[n.category] || n.category}</span>}
                    </div>
                    {n.comment && <p className="fb-all-comment">{n.comment}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
