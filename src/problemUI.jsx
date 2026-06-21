import { useState } from 'react';
import { getStatusClass } from './problemMeta.js';

export function ProgressSummary({ solved, total, visibleCount, loaded }) {
  const pct = total > 0 ? (solved / total) * 100 : 0;
  return (
    <div className="progress-card">
      <div className="progress-info">
        <span className="progress-count">
          <b>{solved}</b> / {total} solved
          <span className="progress-pct">{pct.toFixed(1)}%</span>
        </span>
        <span className="muted" id="summary">
          {loaded ? `${visibleCount} shown` : 'Loading…'}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Codeforces rating color tiers
function cfColor(rating) {
  if (rating < 1200) return '#808080'; // gray
  if (rating < 1400) return '#008000'; // green
  if (rating < 1600) return '#03a89e'; // cyan
  if (rating < 1900) return '#0000ff'; // blue
  if (rating < 2100) return '#aa00aa'; // purple
  if (rating < 2400) return '#ff8c00'; // orange
  return '#ff0000'; // red
}

export function RatingBadge({ rating }) {
  if (rating == null) return <span className="difficulty difficulty-muted">—</span>;
  const color = cfColor(rating);
  return (
    <span className="difficulty" style={{ color, borderColor: color }}>
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
      title="Click to edit"
    >
      {value === "AC" ? "✓ AC" : (value || "Set status")}
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
        width="16"
        height="16"
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
