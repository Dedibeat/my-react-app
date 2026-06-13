import { useMemo, useState } from 'react';
import './Profile.css';
import { IMPORTANCE_COLOR, getStatusClass } from './problemMeta.js';

const IMPORTANCE_LEVELS = ['p5', 'p4', 'p3', 'p2', 'p1'];
const STATUS_KEYS = ['AC', 'WA', 'TL', 'RE', 'NI'];

function parseTs(ts) {
  return new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
}

const DAY = 86400000;
const HEAT_COLORS = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
const WEEKDAYS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' -> UTC-midnight epoch, so day-adjacency is always exactly DAY (DST-safe).
function dayTime(key) {
  return Date.parse(key);
}

function heatLevel(count) {
  if (!count) return 0;
  if (count >= 7) return 4;
  if (count >= 4) return 3;
  if (count >= 2) return 2;
  return 1;
}

function longestStreak(sortedKeys) {
  let best = 0, cur = 0, prev = null;
  for (const k of sortedKeys) {
    const t = dayTime(k);
    cur = prev !== null && t - prev === DAY ? cur + 1 : 1;
    if (cur > best) best = cur;
    prev = t;
  }
  return best;
}

function Stat({ n, unit, label }) {
  return (
    <div className="activity-stat">
      <span className="activity-stat-n">{n} <small>{unit}</small></span>
      <span className="activity-stat-label">{label}</span>
    </div>
  );
}

function ActivityHeatmap({ problems }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  // dayKey -> number of problems marked AC that day (by last status change).
  const solveCounts = useMemo(() => {
    const m = new Map();
    for (const p of problems) {
      if (p.status === 'AC' && p.statusUpdatedAt) {
        const k = dayKey(parseTs(p.statusUpdatedAt));
        m.set(k, (m.get(k) || 0) + 1);
      }
    }
    return m;
  }, [problems]);

  const years = useMemo(() => {
    const set = new Set([currentYear]);
    for (const k of solveCounts.keys()) set.add(Number(k.slice(0, 4)));
    return [...set].sort((a, b) => b - a);
  }, [solveCounts, currentYear]);

  const isRolling = year === currentYear;

  const { weeks, monthLabels, windowCount } = useMemo(() => {
    let start, end;
    if (isRolling) {
      end = new Date(); end.setHours(0, 0, 0, 0);
      start = new Date(end); start.setDate(start.getDate() - 364);
    } else {
      start = new Date(year, 0, 1);
      end = new Date(year, 11, 31);
    }
    const cursor = new Date(start);
    cursor.setDate(cursor.getDate() - cursor.getDay()); // back to Sunday
    const weeks = [];
    let windowCount = 0;
    while (cursor <= end) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const inRange = cursor >= start && cursor <= end;
        const k = dayKey(cursor);
        const count = inRange ? (solveCounts.get(k) || 0) : 0;
        if (inRange) windowCount += count;
        week.push({ key: k, label: cursor.toDateString(), count, inRange });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    let prevMonth = -1;
    const monthLabels = weeks.map((w) => {
      const m = Number(w[0].key.slice(5, 7)) - 1;
      if (m !== prevMonth) { prevMonth = m; return MONTHS[m]; }
      return '';
    });
    return { weeks, monthLabels, windowCount };
  }, [solveCounts, year, isRolling]);

  const stats = useMemo(() => {
    const keys = [...solveCounts.keys()].sort();
    const today = dayTime(dayKey(new Date()));
    const yearAgo = today - 364 * DAY;
    const monthAgo = today - 29 * DAY;
    let allTime = 0, lastYear = 0, lastMonth = 0;
    for (const [k, c] of solveCounts) {
      const t = dayTime(k);
      allTime += c;
      if (t >= yearAgo) lastYear += c;
      if (t >= monthAgo) lastMonth += c;
    }
    return {
      allTime, lastYear, lastMonth,
      maxStreak: longestStreak(keys),
      yearStreak: longestStreak(keys.filter((k) => dayTime(k) >= yearAgo)),
      monthStreak: longestStreak(keys.filter((k) => dayTime(k) >= monthAgo)),
    };
  }, [solveCounts]);

  return (
    <div className="profile-card activity-card">
      <div className="activity-head">
        <h3 className="profile-card-title">
          {windowCount} {windowCount === 1 ? 'problem' : 'problems'} solved{' '}
          {isRolling ? 'in the last year' : `in ${year}`}
        </h3>
        {years.length > 1 && (
          <select className="activity-year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
      </div>

      <div className="cal">
        <div className="cal-months">
          {monthLabels.map((m, i) => <span key={i}>{m}</span>)}
        </div>
        <div className="cal-body">
          <div className="cal-weekdays">
            {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div className="cal-weeks">
            {weeks.map((w, i) => (
              <div className="cal-week" key={i}>
                {w.map((c) => (
                  <i
                    key={c.key}
                    className={c.inRange ? 'cal-day' : 'cal-day cal-pad'}
                    style={c.inRange ? { background: HEAT_COLORS[heatLevel(c.count)] } : undefined}
                    title={c.inRange ? `${c.count} solved · ${c.label}` : undefined}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-legend">
        <span className="muted">Less</span>
        {HEAT_COLORS.map((col, i) => <i key={i} className="cal-day" style={{ background: col }} />)}
        <span className="muted">More</span>
      </div>

      <div className="activity-stats">
        <Stat n={stats.allTime} unit="problems" label="solved for all time" />
        <Stat n={stats.lastYear} unit="problems" label="solved for the last year" />
        <Stat n={stats.lastMonth} unit="problems" label="solved for the last month" />
        <Stat n={stats.maxStreak} unit="days" label="in a row max" />
        <Stat n={stats.yearStreak} unit="days" label="in a row last year" />
        <Stat n={stats.monthStreak} unit="days" label="in a row last month" />
      </div>
    </div>
  );
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

      <ActivityHeatmap problems={problems} />

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
