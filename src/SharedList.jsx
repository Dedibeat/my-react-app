import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import './Lists.css';
import './ProblemSet.css';
import { RatingBadge, StatusEditor } from './problemUI.jsx';
import { useProblemActions } from './useProblemActions.js';
import { api } from './api.js';

const RENDER_CAP = 500;
const CF_ID_FLOOR = 100000; // same id split as Lists.jsx: CF ids ≥ 100000, ICPC below.

// Group board for a list opened through its share link: who solved which problem.
export default function SharedList({ problems, setProblems, cfProblems, setCfProblems, loaded, user }) {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const resolve = (id) => (Number(id) >= CF_ID_FLOOR ? [cfProblems, setCfProblems] : [problems, setProblems]);
  const { toast, justSolved, updateStatus, showToast } = useProblemActions(problems, setProblems, resolve);

  const load = useCallback(() => (
    api.getShared(token).then(setData).catch((err) => setError(err.message))
  ), [token]);

  useEffect(() => { load(); }, [load]);

  const pool = useMemo(() => {
    const m = new Map();
    for (const p of problems) m.set(p.id, p);
    for (const p of cfProblems) m.set(p.id, p);
    return m;
  }, [problems, cfProblems]);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = [];
    for (const id of data.problem_ids) {
      const p = pool.get(String(id));
      if (p) list.push(p);
    }
    return list.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
  }, [data, pool]);

  // The viewer's own solves come from local state so a status edit shows up at once.
  const board = useMemo(() => {
    if (!data) return [];
    return data.members
      .map((m) => {
        const solved = m.user_id === user.id
          ? new Set(rows.filter((p) => p.status === 'AC').map((p) => p.id))
          : new Set(m.solved.map(String));
        return { ...m, solved };
      })
      .sort((a, b) => b.solved.size - a.solved.size || a.username.localeCompare(b.username));
  }, [data, rows, user.id]);

  async function run(fn, okMsg) {
    setBusy(true);
    try {
      await fn();
      await load();
      if (okMsg) showToast(okMsg, 'success');
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function removeMember(m) {
    const self = m.user_id === user.id;
    if (!window.confirm(self ? 'Leave this shared list?' : `Remove ${m.username} from this list?`)) return;
    run(() => api.removeSharedMember(token, m.user_id), self ? 'Left the list' : `Removed ${m.username}`);
  }

  if (error) {
    return (
      <div className="lists-empty">
        {error}. <Link to="/lists">Back to lists</Link>
      </div>
    );
  }
  if (!data || !loaded) {
    return <div className="lists-empty">Loading…</div>;
  }

  const total = rows.length;
  const me = data.members.find((m) => m.user_id === user.id);

  return (
    <>
      <div className="list-detail-head">
        <Link to="/lists" className="btn list-detail-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Lists
        </Link>
        <h2 className="lists-title">{data.name}</h2>
        <span className="list-detail-count">{total} problems</span>
        <span className="list-card-owner">by {data.owner}</span>
        <span className="modal-spacer" />
        {!data.is_member && (
          <button type="button" className="btn btn-primary" disabled={busy}
            onClick={() => run(() => api.joinShared(token), 'Joined — your solves now show on the board')}>
            Join list
          </button>
        )}
        {me && !me.is_owner && (
          <button type="button" className="btn btn-danger-ghost" disabled={busy} onClick={() => removeMember(me)}>
            Leave
          </button>
        )}
      </div>

      <div className="board">
        {board.map((m) => {
          const pct = total > 0 ? (m.solved.size / total) * 100 : 0;
          return (
            <div key={m.user_id} className={`board-row ${m.user_id === user.id ? 'board-row-me' : ''}`}>
              <span className="board-name">
                {m.username}
                {m.is_owner && <span className="list-card-shared">owner</span>}
              </span>
              <div className="list-card-track">
                <div className="list-card-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="list-card-solved">{m.solved.size}/{total}</span>
              {data.is_owner && !m.is_owner ? (
                <button type="button" className="board-remove" title={`Remove ${m.username}`}
                  aria-label={`Remove ${m.username}`} disabled={busy} onClick={() => removeMember(m)}>
                  ×
                </button>
              ) : <span />}
            </div>
          );
        })}
      </div>

      <div className="table-card">
        {total > RENDER_CAP && (
          <div className="table-note">Showing first {RENDER_CAP} of {total}.</div>
        )}
        <table id="problemsTable" className="tags-hidden">
          <thead>
            <tr>
              <th data-label="ID">ID</th>
              <th data-label="Contest">Contest</th>
              <th data-label="Problem">Problem</th>
              <th data-label="Rating">Rating</th>
              <th data-label="Status">Status</th>
              <th data-label="Solved by">Solved by</th>
            </tr>
          </thead>
          <tbody>
            {total === 0 && (
              <tr className="empty-row"><td colSpan={6}>This list has no problems yet.</td></tr>
            )}
            {rows.slice(0, RENDER_CAP).map((p) => {
              const solvers = board.filter((m) => m.solved.has(p.id));
              return (
                <tr key={p.id} className={p.status === 'AC' ? 'row-solved' : ''}>
                  <td className="cell-id" data-label="ID">{p.id}</td>
                  <td data-label="Contest">{p.contest}</td>
                  <td data-label="Problem">
                    <a className="problem-link" href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
                  </td>
                  <td data-label="Rating"><RatingBadge rating={p.rating} /></td>
                  <td className="cell-status" data-label="Status">
                    <StatusEditor
                      value={p.status}
                      onChange={(s) => updateStatus(p.id, s)}
                      celebrating={justSolved === p.id}
                    />
                  </td>
                  <td data-label="Solved by">
                    <div className="solved-by">
                      {solvers.length === 0 && <span className="solved-none">—</span>}
                      {solvers.map((m) => (
                        <span key={m.user_id} className={`solved-chip ${m.user_id === user.id ? 'solved-chip-me' : ''}`}>
                          {m.username}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {toast && <div className={`toast toast-${toast.kind}`} role="status">{toast.msg}</div>}
    </>
  );
}
