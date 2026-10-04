import { useState } from 'react';
import { getStatusClass } from './problemMeta.js';

// `visibleSolved` is optional; when given and a filter is active, the solved count
// of the filtered rows is shown next to "N shown".
export function ProgressSummary({ solved, total, visibleCount, visibleSolved, loaded }) {
  const pct = total > 0 ? (solved / total) * 100 : 0;
  const filtered = visibleSolved != null && visibleCount < total;
  return (
    <div className="progress-card">
      <div className="progress-info">
        <span className="progress-count">
          <b>{solved}</b> <span className="progress-slash">/</span> {total} solved
          <span className="progress-pct">{pct.toFixed(1)}%</span>
        </span>
        <span className="progress-visible-count" id="summary">
          {!loaded
            ? 'Loading…'
            : filtered
              ? `${visibleSolved.toLocaleString()} of ${visibleCount.toLocaleString()} shown solved`
              : `${visibleCount.toLocaleString()} shown`}
        </span>
      </div>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Contest name, linked to the contest page when known (QOJ contests; Codeforces rows have
// none), plus a book icon linking the contest's editorial when the dataset has one.
export function ContestLink({ problem }) {
  const title = problem.region ? `${problem.contest} · ${problem.region}` : problem.contest;
  return (
    <span className="contest-cell">
      {problem.contestUrl ? (
        <a className="contest-link" href={problem.contestUrl} target="_blank" rel="noopener noreferrer" title={title}>
          {problem.contest}
        </a>
      ) : (
        <span className="contest-link" title={title}>{problem.contest}</span>
      )}
      {problem.editorialUrl && (
        <a
          className="editorial-link"
          href={problem.editorialUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Contest editorial"
          aria-label={`Editorial for ${problem.contest}`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
            <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
          </svg>
        </a>
      )}
    </span>
  );
}

// While tags are hidden: a small button next to the problem name that reveals just this
// problem's tags, so you can practice spoiler-free and peek when stuck.
export function TagPeek({ tags }) {
  const [open, setOpen] = useState(false);
  if (!tags.length) return null;
  return (
    <>
      <button
        type="button"
        className={`tag-peek ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? 'Hide tags' : 'Peek at tags'}
        title={open ? 'Hide tags' : 'Peek at tags'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      </button>
      {open && (
        <div className="tags tag-peek-list">
          {tags.map((t, i) => <span key={i} className="tag">{t}</span>)}
        </div>
      )}
    </>
  );
}

// Codeforces rating color tiers (soft-background badge design)
function cfClass(rating) {
  if (rating < 1200) return 'difficulty-grey';
  if (rating < 1400) return 'difficulty-green';
  if (rating < 1600) return 'difficulty-teal';
  if (rating < 1900) return 'difficulty-blue';
  if (rating < 2100) return 'difficulty-violet';
  if (rating < 2400) return 'difficulty-orange';
  return 'difficulty-red';
}

export function RatingBadge({ rating }) {
  if (rating == null) return <span className="difficulty difficulty-muted">—</span>;
  return (
    <span className={`difficulty ${cfClass(rating)}`}>
      {Math.round(rating)}
    </span>
  );
}

export function ConfettiBurst() {
  return (
    <span className="confetti" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => <i key={i} />)}
    </span>
  );
}

export function StatusEditor({ value, onChange, celebrating }) {
  const statuses = ["AC", "WA", "TL", "RE", "NI", "No submission"];
  const [editing, setEditing] = useState(false);

  if (editing) {
    const current = value || "No submission";
    return (
      <select
        autoFocus
        className="status-select"
        value={current}
        onChange={(e) => {
          const next = e.target.value === "No submission" ? "" : e.target.value;
          onChange(next);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      >
        {statuses.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    );
  }
  return (
    <button
      type="button"
      className={`status-pill ${getStatusClass(value)} ${value ? '' : 'status-empty'} ${celebrating ? 'pop' : ''}`}
      onClick={() => setEditing(true)}
      title="Click to edit status"
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-text">{value === "AC" ? "AC" : (value || "Set status")}</span>
      {celebrating && <ConfettiBurst />}
    </button>
  );
}

export function FeedbackButton({ hasFeedback, onClick }) {
  return (
    <button
      type="button"
      className={`feedback-btn ${hasFeedback ? 'has-feedback' : ''}`}
      onClick={onClick}
      aria-pressed={hasFeedback}
      title={hasFeedback ? 'Edit your feedback' : 'Give feedback'}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill={hasFeedback ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
