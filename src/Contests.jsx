import { useState, useEffect, useMemo } from 'react';
import './ProblemSet.css';
import './Lists.css';
import './FeedbackModal.css';
import './Contests.css';
import { ContestLink, RatingBadge } from './problemUI.jsx';
import { api } from './api.js';
import { loadFieldIndex, loadField, resultFor } from './performance.js';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function describe(r) {
  const who = r.kind === 'official' ? `Official (${r.team_name})` : 'Virtual';
  return `${who} · ${r.participated_on} · ${r.solved} solved, ${r.penalty} min`;
}

// Saved results for one contest, plus a form to add a virtual or official one with a
// live rank/performance preview against the contest's real final standings.
function ResultsModal({ contest, index, results, onAdd, onDelete, onClose }) {
  const [field, setField] = useState(null);
  const [kind, setKind] = useState('virtual');
  const [day, setDay] = useState(todayKey);
  const [solved, setSolved] = useState('');
  const [penalty, setPenalty] = useState('');
  const [teamQuery, setTeamQuery] = useState('');
  const [team, setTeam] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadField(contest.id).then(setField).catch(() => setError('Could not load the standings.'));
  }, [contest.id]);

  const draft = kind === 'virtual'
    ? (solved !== '' ? { kind, solved: Number(solved), penalty: Number(penalty) || 0 } : null)
    : (team ? { kind, solved: team[2], penalty: team[3], team_name: team[0] } : null);
  const preview = draft && field ? resultFor(index, field, draft) : null;

  const matches = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    if (!field || !q) return [];
    return field.teams.filter((t) => `${t[0]} ${t[1]}`.toLowerCase().includes(q)).slice(0, 8);
  }, [field, teamQuery]);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await onAdd({ contest_id: contest.id, ...draft, participated_on: day });
      setSolved('');
      setPenalty('');
      setTeam(null);
      setTeamQuery('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal-card results-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="results-title"
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <div>
          <h2 className="modal-title" id="results-title">{contest.contest}</h2>
          <p className="modal-subtitle">
            {contest.region}{field ? ` · ${field.teams.length} teams in the final standings` : ''}
          </p>
        </div>

        {results.length > 0 && (
          <ul className="results-list">
            {results.map((r) => {
              const res = field ? resultFor(index, field, r) : null;
              return (
                <li key={r.id}>
                  <span className="results-what">{describe(r)}</span>
                  {res && <span className="muted">#{res.rank} of {res.of}</span>}
                  {res && <RatingBadge rating={res.performance} />}
                  <button type="button" className="board-remove" aria-label="Delete result" title="Delete" onClick={() => onDelete(r)}>×</button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="field">
          <span>Add a result</span>
          <div className="chip-row" role="group" aria-label="Kind">
            {['virtual', 'official'].map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} className={`chip ${kind === k ? 'chip-on' : ''}`} onClick={() => setKind(k)}>
                {k === 'virtual' ? 'Virtual' : 'Official'}
              </button>
            ))}
          </div>
        </div>

        <div className="results-inputs">
          <label className="field">
            <span>Date</span>
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          {kind === 'virtual' && (
            <>
              <label className="field">
                <span>Solved</span>
                <input type="number" min={0} value={solved} onChange={(e) => setSolved(e.target.value)} />
              </label>
              <label className="field">
                <span>Penalty (min)</span>
                <input type="number" min={0} value={penalty} onChange={(e) => setPenalty(e.target.value)} />
              </label>
            </>
          )}
          {kind === 'official' && (
            <label className="field results-team">
              <span>Your team in the standings</span>
              <input
                type="search"
                placeholder="team or university name"
                value={teamQuery}
                onChange={(e) => { setTeamQuery(e.target.value); setTeam(null); }}
              />
            </label>
          )}
        </div>

        {kind === 'official' && matches.length > 0 && !team && (
          <ul className="team-matches">
            {matches.map((t, i) => (
              <li key={i}>
                <button type="button" onClick={() => { setTeam(t); setTeamQuery(t[0]); }}>
                  <span className="muted">#{t[6]}</span>
                  <span className="team-name">{t[0]}{t[1] ? <span className="muted"> · {t[1]}</span> : null}</span>
                  <span className="muted">{t[2]} solved · {t[3]} min</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {preview && (
          <p className="results-preview">
            Rank <b>{preview.rank}</b> of {preview.of} · performance <RatingBadge rating={preview.performance} />
          </p>
        )}
        {error && <div className="auth-error">{error}</div>}

        <div className="modal-actions">
          <span className="muted results-note">Placed in the real final standings, Codeforces scale.</span>
          <span className="modal-spacer" />
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" disabled={!preview || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Contests({ problems, loaded }) {
  const [index, setIndex] = useState(null);
  const [results, setResults] = useState([]);
  const [fields, setFields] = useState({}); // contest id -> standings, for contests you have results in
  const [region, setRegion] = useState('all');
  const [show, setShow] = useState('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadFieldIndex().then(setIndex).catch(() => {});
    api.getParticipations().then(setResults).catch(() => {});
  }, []);

  useEffect(() => {
    for (const id of new Set(results.map((r) => r.contest_id))) {
      if (fields[id]) continue;
      loadField(id).then((f) => setFields((cur) => ({ ...cur, [id]: f }))).catch(() => {});
    }
  }, [results, fields]);

  const contests = useMemo(() => {
    const byId = new Map();
    for (const p of problems) {
      let c = byId.get(p.contestId);
      if (!c) {
        c = {
          id: p.contestId, contest: p.contest, contestUrl: p.contestUrl, editorialUrl: p.editorialUrl,
          region: p.region, year: p.year, total: 0, solved: 0, touched: 0,
        };
        byId.set(p.contestId, c);
      }
      c.total++;
      if (p.status === 'AC') c.solved++;
      if (p.status) c.touched++;
    }
    return [...byId.values()].sort((a, b) => (b.year || 0) - (a.year || 0) || a.contest.localeCompare(b.contest));
  }, [problems]);

  const regions = useMemo(() => [...new Set(contests.map((c) => c.region).filter(Boolean))].sort(), [contests]);

  const resultsByContest = useMemo(() => {
    const m = new Map();
    for (const r of results) {
      if (!m.has(r.contest_id)) m.set(r.contest_id, []);
      m.get(r.contest_id).push(r);
    }
    return m;
  }, [results]);

  const visible = contests.filter((c) => {
    if (region !== 'all' && c.region !== region) return false;
    if (query.trim() && !c.contest.toLowerCase().includes(query.trim().toLowerCase())) return false;
    const done = resultsByContest.has(c.id);
    if (show === 'done') return done;
    if (show === 'untouched') return !done && c.touched === 0;
    return true;
  });

  const ratedIds = useMemo(() => new Set(index?.ids || []), [index]);
  const open = openId != null ? contests.find((c) => c.id === openId) : null;

  function showToast(msg, kind = 'success') {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }

  async function addResult(r) {
    const saved = await api.addParticipation(r);
    setResults((cur) => [saved, ...cur]);
    showToast('Result saved');
  }

  async function deleteResult(r) {
    if (!window.confirm(`Delete this result? ${describe(r)}`)) return;
    try {
      await api.deleteParticipation(r.id);
      setResults((cur) => cur.filter((x) => x.id !== r.id));
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    }
  }

  return (
    <>
      <div className="lists-head">
        <div>
          <h2 className="lists-title">Contests</h2>
          <p className="lists-subtitle">
            Pick a past contest for a virtual, then save your result to see the rank and performance you&apos;d have had.
          </p>
        </div>
      </div>

      <div className="controls">
        <label>
          Show:
          <select className="inline-select" value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="all">All</option>
            <option value="done">With results</option>
            <option value="untouched">Untouched</option>
          </select>
        </label>
        <label>
          Region:
          <select className="inline-select" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">All</option>
            {regions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label>
          Search:
          <input type="search" placeholder="contest name or year" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {!loaded ? (
        <div className="lists-empty">Loading…</div>
      ) : (
        <div className="table-card">
          <table id="problemsTable" className="contests-table">
            <thead>
              <tr>
                <th data-label="Contest">Contest</th>
                <th data-label="Region">Region</th>
                <th data-label="Your solves">Your solves</th>
                <th data-label="Results">Results</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr className="empty-row"><td colSpan={5}>No contests match.</td></tr>
              )}
              {visible.map((c) => {
                const mine = resultsByContest.get(c.id) || [];
                const rated = ratedIds.has(c.id);
                return (
                  <tr key={c.id}>
                    <td data-label="Contest"><ContestLink problem={c} /></td>
                    <td data-label="Region" className="muted">{c.region}</td>
                    <td data-label="Your solves">
                      <span className="contest-solves">
                        <span className="mini-track"><span className="mini-fill" style={{ width: `${(c.solved / c.total) * 100}%` }} /></span>
                        {c.solved}/{c.total}
                      </span>
                    </td>
                    <td data-label="Results">
                      <span className="result-chips">
                        {mine.slice(0, 3).map((r) => {
                          const res = fields[c.id] && index ? resultFor(index, fields[c.id], r) : null;
                          return (
                            <span key={r.id} className="result-chip" title={describe(r) + (res ? ` · rank ${res.rank} of ${res.of}` : '')}>
                              <span className="result-kind">{r.kind === 'official' ? 'Off' : 'Vir'}</span>
                              {res ? <RatingBadge rating={res.performance} /> : <span className="muted">…</span>}
                            </span>
                          );
                        })}
                        {mine.length > 3 && <span className="muted">+{mine.length - 3}</span>}
                      </span>
                    </td>
                    <td className="contest-action">
                      <button
                        type="button"
                        className="btn"
                        disabled={!rated}
                        title={rated ? 'Add or view results' : 'No standings data for this contest'}
                        onClick={() => setOpenId(c.id)}
                      >
                        {mine.length ? 'Results' : 'Add result'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && index && (
        <ResultsModal
          contest={open}
          index={index}
          results={resultsByContest.get(open.id) || []}
          onAdd={addResult}
          onDelete={deleteResult}
          onClose={() => setOpenId(null)}
        />
      )}
      {toast && <div className={`toast toast-${toast.kind}`} role="status">{toast.msg}</div>}
    </>
  );
}
