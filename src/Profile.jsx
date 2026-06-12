import { useMemo } from 'react';
import './Profile.css';
import { IMPORTANCE_COLOR, getStatusClass } from './problemMeta.js';

const IMPORTANCE_LEVELS = ['p5', 'p4', 'p3', 'p2', 'p1'];
const STATUS_KEYS = ['AC', 'WA', 'TL', 'RE', 'NI'];

function parseTs(ts) {
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Profile({ user, problems, loaded }) {
  const stats = useMemo(() => {
    const total = problems.length;
    let solved = 0;
    const byImportance = {};
    for (const lvl of IMPORTANCE_LEVELS) byImportance[lvl] = { solved: 0, total: 0 };
    const byStatus = { AC: 0, WA: 0, TL: 0, RE: 0, NI: 0 };
    for (const p of problems) {
      if (p.status === 'AC') solved++;
      if (p.importance in byImportance) {
        byImportance[p.importance].total++;
        if (p.status === 'AC') byImportance[p.importance].solved++;
      }
      if (p.status in byStatus) byStatus[p.status]++;
    }
    const recent = problems
      .filter((p) => p.status && p.statusUpdatedAt)
      .sort((a, b) => parseTs(b.statusUpdatedAt) - parseTs(a.statusUpdatedAt))
      .slice(0, 8);
    return { total, solved, byImportance, byStatus, recent };
  }, [problems]);

  if (!loaded) {
    return (
      <div className="loading-state">
        <span className="spinner" /> Loading profile…
      </div>
    );
  }

  const pct = stats.total > 0 ? (stats.solved / stats.total) * 100 : 0;
  const joined = user.created_at
    ? parseTs(user.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="profile">
      <div className="profile-card profile-identity">
        <span className="profile-avatar">{user.username.charAt(0)}</span>
        <div>
          <h2 className="profile-name">{user.username}</h2>
          <p className="muted profile-joined">
            {joined ? `Joined ${joined}` : 'Member'} · {stats.solved} solved
          </p>
        </div>
      </div>

      <div className="profile-card">
        <div className="progress-info">
          <span className="progress-count">
            <b>{stats.solved}</b> / {stats.total} solved
            <span className="progress-pct">{pct.toFixed(1)}%</span>
          </span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="profile-grid">
        <div className="profile-card">
          <h3 className="profile-card-title">By importance</h3>
          <div className="importance-rows">
            {IMPORTANCE_LEVELS.map((lvl) => {
              const { solved, total } = stats.byImportance[lvl];
              const rowPct = total > 0 ? (solved / total) * 100 : 0;
              return (
                <div className="importance-row" key={lvl}>
                  <span className="importance" style={{ background: IMPORTANCE_COLOR[lvl] }}>
                    {lvl.toUpperCase()}
                  </span>
                  <div className="mini-track">
                    <div className="mini-fill" style={{ width: `${rowPct}%` }} />
                  </div>
                  <span className="importance-row-count">{solved}/{total}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="profile-card">
          <h3 className="profile-card-title">By status</h3>
          <div className="status-tiles">
            {STATUS_KEYS.map((s) => (
              <div className={`status-tile status-tile-${s.toLowerCase()}`} key={s}>
                <span className="status-tile-count">{stats.byStatus[s]}</span>
                <span className="status-tile-label">{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="profile-card">
        <h3 className="profile-card-title">Recent activity</h3>
        {stats.recent.length === 0 ? (
          <p className="muted">No activity yet — go solve something.</p>
        ) : (
          <ul className="activity-list">
            {stats.recent.map((p) => (
              <li key={p.id} className="activity-row">
                <span className={`status-pill activity-pill ${getStatusClass(p.status)}`}>
                  {p.status === 'AC' ? '✓ AC' : p.status}
                </span>
                <a className="problem-link" href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.name}
                </a>
                <span className="muted activity-time">
                  {relativeTime(parseTs(p.statusUpdatedAt))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
