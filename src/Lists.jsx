import { useState, useEffect, useMemo, useRef } from 'react';
import './Lists.css';
import './ProblemSet.css';
import { parseSearch, evalSearchAst } from './search.js';
import FeedbackModal from './FeedbackModal.jsx';
import { ProgressSummary, RatingBadge, StatusEditor, FeedbackButton } from './problemUI.jsx';
import { useProblemActions } from './useProblemActions.js';
import { api } from './api.js';

const RENDER_CAP = 500;
const CF_ID_FLOOR = 100000; // Codeforces ids are ≥ contestId*100000; ICPC ids are ~6k–15k.

// Problem pools are two separate state arrays in App (ICPC + Codeforces). A list
// can hold both; route status updates by id range so they land in the right one.
function isCfId(id) {
  return Number(id) >= CF_ID_FLOOR;
}

function hayFor(p) {
  return isCfId(p.id)
    ? `${p.name} ${p.code} ${p.tags}`.toLowerCase()
    : `${p.name} ${p.searchKey} ${p.tags}`.toLowerCase();
}

function SkeletonCard() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ width: `${90 - i * 5}%` }} />
      ))}
    </div>
  );
}

export default function Lists({
  problems, setProblems, cfProblems, setCfProblems,
  loaded, isAdmin, lists, reloadLists,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState(null); // list id, or 'detail'
  const [renameVal, setRenameVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  // members-table controls
  const [showTag, setShowTag] = useState(false);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('rating_desc');
  const [searchInput, setSearchInput] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [ratingMin, setRatingMin] = useState(null);
  const [ratingMax, setRatingMax] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  // edit-panel search (add new + delete existing from one query)
  const [addInput, setAddInput] = useState('');
  const [addCommitted, setAddCommitted] = useState('');

  const pool = useMemo(() => {
    const m = new Map();
    for (const p of problems) m.set(p.id, p);
    for (const p of cfProblems) m.set(p.id, p);
    return m;
  }, [problems, cfProblems]);

  const resolve = (id) => (isCfId(id) ? [cfProblems, setCfProblems] : [problems, setProblems]);

  const {
    feedback, feedbackFor, setFeedbackFor,
    toast, justSolved,
    updateStatus, submitFeedback, deleteFeedback, showToast,
  } = useProblemActions(problems, setProblems, resolve);

  // Stable handle for use inside effects (showToast itself is recreated per render).
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    setEditing(false);
    setSelected(new Set());
    let cancelled = false;
    setDetailLoading(true);
    api.getList(selectedId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) { setSelectedId(null); showToastRef.current('Could not load list', 'error'); } })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const memberSet = useMemo(
    () => new Set((detail?.problem_ids || []).map(String)),
    [detail],
  );

  const members = useMemo(() => {
    if (!detail) return { list: [], missing: 0 };
    let missing = 0;
    const list = [];
    for (const id of detail.problem_ids) {
      const p = pool.get(String(id));
      if (p) list.push(p);
      else missing++;
    }
    return { list, missing };
  }, [detail, pool]);

  const solvedCount = useMemo(
    () => members.list.reduce((n, p) => n + (p.status === "AC" ? 1 : 0), 0),
    [members],
  );

  const searchAst = useMemo(() => {
    if (!committedSearch.trim()) return null;
    try { return parseSearch(committedSearch); }
    catch { return null; }
  }, [committedSearch]);

  const visible = useMemo(() => {
    let list = members.list;

    if (filter === "solved") {
      list = list.filter((p) => p.status === "AC");
    } else if (filter === "unsolved") {
      list = list.filter((p) => p.status && p.status !== "AC" && p.status !== "No submission");
    } else if (filter === "no submission") {
      list = list.filter((p) => !p.status);
    }

    if (ratingMin != null) {
      list = list.filter((p) => p.rating >= ratingMin);
    }
    if (ratingMax != null) {
      list = list.filter((p) => p.rating <= ratingMax);
    }

    if (searchAst) {
      list = list.filter((p) => evalSearchAst(searchAst, hayFor(p)));
    }

    const ratingOf = (p) => Number(p.rating) || 0;
    const sorted = list.slice();
    if (sort === "rating_desc") {
      sorted.sort((a, b) => ratingOf(b) - ratingOf(a));
    } else if (sort === "rating_asc") {
      sorted.sort((a, b) => ratingOf(a) - ratingOf(b));
    } else if (sort === "id_asc") {
      sorted.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return sorted;
  }, [members, filter, sort, ratingMin, ratingMax, searchAst]);

  const capped = visible.slice(0, RENDER_CAP);

  // ---- edit-panel search: one query across the whole pool, split by membership ----
  const searchMatches = useMemo(() => {
    if (!addCommitted.trim()) return [];
    let ast;
    try { ast = parseSearch(addCommitted); } catch { return []; }
    if (!ast) return [];
    return [...pool.values()].filter((p) => evalSearchAst(ast, hayFor(p)));
  }, [addCommitted, pool]);

  const newMatches = useMemo(
    () => searchMatches.filter((p) => !memberSet.has(p.id)),
    [searchMatches, memberSet],
  );

  const deleteMatches = useMemo(
    () => searchMatches.filter((p) => memberSet.has(p.id)),
    [searchMatches, memberSet],
  );

  async function refreshDetail() {
    const fresh = await api.getList(detail.id);
    setDetail(fresh);
  }

  async function createList() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await api.createList(name);
      setNewName('');
      await reloadLists();
    } catch (err) {
      showToast(`Create failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveRename(list) {
    const name = renameVal.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.renameList(list.id, name);
      setRenamingId(null);
      if (selectedId === list.id && detail) setDetail({ ...detail, name });
      await reloadLists();
    } catch (err) {
      showToast(`Rename failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteList(list) {
    if (!window.confirm(`Delete list "${list.name}"? The problems themselves keep their statuses.`)) return;
    setBusy(true);
    try {
      await api.deleteList(list.id);
      if (selectedId === list.id) setSelectedId(null);
      await reloadLists();
      showToast('List deleted', 'success');
    } catch (err) {
      showToast(`Delete failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function addAllMatches() {
    const ids = newMatches.map((p) => Number(p.id));
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const res = await api.addToList(detail.id, ids);
      await refreshDetail();
      reloadLists();
      showToast(
        res.existing > 0 ? `Added ${res.added} (${res.existing} already in list)` : `Added ${res.added} to list`,
        'success',
      );
    } catch (err) {
      showToast(`Add failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeAllMatches() {
    const ids = deleteMatches.map((p) => Number(p.id));
    if (!ids.length || busy) return;
    if (!window.confirm(`Remove ${ids.length} ${ids.length === 1 ? 'problem' : 'problems'} from this list?`)) return;
    setBusy(true);
    try {
      await api.removeFromList(detail.id, ids);
      await refreshDetail();
      reloadLists();
      showToast(`Removed ${ids.length}`, 'success');
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    const ids = [...selected].map(Number);
    if (!ids.length || busy) return;
    if (!window.confirm(`Remove ${ids.length} ${ids.length === 1 ? 'problem' : 'problems'} from this list?`)) return;
    setBusy(true);
    try {
      await api.removeFromList(detail.id, ids);
      await refreshDetail();
      setSelected(new Set());
      reloadLists();
      showToast(`Removed ${ids.length}`, 'success');
    } catch (err) {
      showToast(`Remove failed: ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllSelected() {
    setSelected((cur) => {
      const all = visible.every((p) => cur.has(p.id));
      const next = new Set(cur);
      if (all) for (const p of visible) next.delete(p.id);
      else for (const p of visible) next.add(p.id);
      return next;
    });
  }

  // ---------- overview ----------
  if (selectedId === null) {
    return (
      <>
        <div className="lists-head">
          <h2 className="lists-title">My lists</h2>
          <div className="lists-create">
            <input
              type="text"
              placeholder="New list name"
              maxLength={100}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createList(); }}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !newName.trim()}
              onClick={createList}
            >
              {busy ? 'Creating…' : 'Create list'}
            </button>
          </div>
        </div>

        {!loaded ? (
          <SkeletonCard />
        ) : lists.length === 0 ? (
          <div className="lists-empty">
            No lists yet. Create one above, or select problems on the Problem Set page and add them to a list.
          </div>
        ) : (
          <div className="lists-grid">
            {lists.map((l) => {
              const pct = l.problem_count > 0 ? (l.solved_count / l.problem_count) * 100 : 0;
              return (
                <div
                  key={l.id}
                  className="list-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(l.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(l.id); }}
                >
                  <div className="list-card-head">
                    <span className="list-card-name">{l.name}</span>
                    <span className="list-card-count">{l.problem_count} problems</span>
                  </div>
                  <div className="list-card-progress">
                    <div className="list-card-track">
                      <div className="list-card-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="list-card-solved">{l.solved_count}/{l.problem_count}</span>
                  </div>
                  <div className="list-card-actions" onClick={(e) => e.stopPropagation()}>
                    {renamingId === l.id ? (
                      <span className="list-rename-row">
                        <input
                          autoFocus
                          value={renameVal}
                          maxLength={100}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(l);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                        />
                        <button type="button" className="btn" onClick={() => saveRename(l)}>Save</button>
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn"
                          onClick={() => { setRenamingId(l.id); setRenameVal(l.name); }}
                        >
                          Rename
                        </button>
                        <button type="button" className="btn btn-danger-ghost" onClick={() => deleteList(l)}>
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {toast && <div className={`toast toast-${toast.kind}`} role="status">{toast.msg}</div>}
      </>
    );
  }

  // ---------- detail ----------
  return (
    <>
      <div className="list-detail-head">
        <button type="button" className="btn" onClick={() => setSelectedId(null)}>← Lists</button>
        {renamingId === 'detail' && detail ? (
          <span className="list-rename-row">
            <input
              autoFocus
              value={renameVal}
              maxLength={100}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRename(detail);
                if (e.key === 'Escape') setRenamingId(null);
              }}
            />
            <button type="button" className="btn" onClick={() => saveRename(detail)}>Save</button>
          </span>
        ) : (
          <h2 className="lists-title">{detail ? detail.name : '…'}</h2>
        )}
        <span className="list-detail-count">
          {detail ? `${detail.problem_ids.length} problems` : ''}
        </span>
        {members.missing > 0 && (
          <span className="list-detail-missing" title="These problems are not in the current dataset">
            {members.missing} not in dataset
          </span>
        )}
        <span className="modal-spacer" />
        {detail && (
          <>
            <button
              type="button"
              className={`btn ${editing ? 'btn-primary' : ''}`}
              onClick={() => { setEditing(!editing); setSelected(new Set()); }}
            >
              {editing ? 'Done editing' : 'Edit problems'}
            </button>
            <button type="button" className="btn" onClick={() => { setRenamingId('detail'); setRenameVal(detail.name); }}>
              Rename
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={() => deleteList(detail)}>
              Delete list
            </button>
          </>
        )}
      </div>

      {detail && editing && (
        <div className="add-panel">
          <div className="add-panel-row">
            <input
              type="search"
              placeholder="Search problems to add or remove — name, tags, code (and, or, not, ())"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setAddCommitted(addInput); }}
            />
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setAddCommitted(addInput)}
              aria-label="Search"
              title="Search"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
          </div>
          {addCommitted.trim() && (
            <div className="add-panel-result">
              <span>
                {searchMatches.length} {searchMatches.length === 1 ? 'match' : 'matches'} for “{addCommitted}”
              </span>
              <span className="add-panel-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={newMatches.length === 0 || busy}
                  onClick={addAllMatches}
                >
                  {busy ? 'Adding…' : `Add all ${newMatches.length}`}
                </button>
                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  disabled={deleteMatches.length === 0 || busy}
                  onClick={removeAllMatches}
                >
                  {busy ? 'Removing…' : `Delete all ${deleteMatches.length}`}
                </button>
              </span>
            </div>
          )}
          {searchMatches.length > 0 && (
            <ul className="add-preview">
              {searchMatches.slice(0, 5).map((p) => (
                <li key={p.id}>
                  <span className="preview-name">{p.name}</span>
                  {p.rating != null && <span className="preview-rating">{p.rating}</span>}
                </li>
              ))}
              {searchMatches.length > 5 && <li className="muted">…and {searchMatches.length - 5} more</li>}
            </ul>
          )}
        </div>
      )}



      {detailLoading || !detail ? (
        <SkeletonCard />
      ) : (
        <>
          <ProgressSummary
            solved={solvedCount}
            total={members.list.length}
            visibleCount={visible.length}
            loaded={loaded}
          />

          <div className="controls">
            <label>
              Quick filter:
              <select className="inline-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="solved">Solved</option>
                <option value="unsolved">Unsolved</option>
                <option value="no submission">No submission</option>
              </select>
            </label>
            <label>
              Sort by:
              <select className="inline-select" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="rating_desc">Rating ↓</option>
                <option value="rating_asc">Rating ↑</option>
                <option value="id_asc">ID ↑</option>
              </select>
            </label>
            <label>
              Search:
              <input
                type="search"
                placeholder="name, tags, contest  (and, or, not, ())"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') setCommittedSearch(searchInput); }}
              />
              <button type="button" className="btn btn-icon" onClick={() => setCommittedSearch(searchInput)} aria-label="Search" title="Search">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            </label>
            <label className="rating-filter">
              Rating:
              <input
                type="number"
                className="rating-input"
                placeholder="min"
                min={0}
                step={100}
                value={ratingMin ?? ""}
                onChange={(e) => setRatingMin(e.target.value ? Number(e.target.value) : null)}
              />
              <span className="rating-dash">–</span>
              <input
                type="number"
                className="rating-input"
                placeholder="max"
                min={0}
                step={100}
                value={ratingMax ?? ""}
                onChange={(e) => setRatingMax(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
            <button className="btn" onClick={() => setShowTag(!showTag)}>
              {showTag ? 'Hide tags' : 'Show tags'}
            </button>
          </div>

          {editing && selected.size > 0 && (
            <div className="bulk-bar">
              <span>{selected.size} selected</span>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={removeSelected}>
                Remove from list
              </button>
              <button type="button" className="btn" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}

          <div className="table-card">
            {visible.length > RENDER_CAP && (
              <div className="table-note">
                Showing first {RENDER_CAP} of {visible.length} — refine filters or search to narrow the list.
              </div>
            )}
            <table id="problemsTable" className={showTag ? "" : "tags-hidden"} aria-describedby="summary">
              <thead>
                <tr>
                  {editing && (
                    <th className="cell-check">
                      <input
                        type="checkbox"
                        aria-label="Select all shown"
                        checked={visible.length > 0 && visible.every((p) => selected.has(p.id))}
                        onChange={toggleAllSelected}
                      />
                    </th>
                  )}
                  <th style={{ width: 70 }} data-label="ID">ID</th>
                  <th data-label="Contest">Contest</th>
                  <th data-label="Problem">Problem</th>
                  <th data-label="Tags">Tags</th>
                  <th data-label="Rating">Rating</th>
                  <th style={{ width: 180 }} title="Click a cell to edit" data-label="Status">Status</th>
                  <th style={{ width: 44 }} aria-label="Feedback" data-label="Feedback" />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={editing ? 8 : 7}>No problems match your filters.</td>
                  </tr>
                )}
                {capped.map((p) => (
                  <tr key={p.id} className={p.status === "AC" ? "row-solved" : ""}>
                    {editing && (
                      <td className="cell-check">
                        <input
                          type="checkbox"
                          aria-label={`Select ${p.name}`}
                          checked={selected.has(p.id)}
                          onChange={() => toggleSelected(p.id)}
                        />
                      </td>
                    )}
                    <td className="cell-id" data-label="ID">{p.id}</td>
                    <td data-label="Contest">{p.contest}</td>
                    <td data-label="Problem">
                      <a className="problem-link" href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
                    </td>
                    <td data-label="Tags">
                      <div className="tags">
                        {p.tagList.map((t, i) => (
                          <span key={i} className="tag">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td data-label="Rating"><RatingBadge rating={p.rating} /></td>
                    <td className="cell-status" data-label="Status">
                      <StatusEditor
                        value={p.status}
                        onChange={(newStatus) => updateStatus(p.id, newStatus)}
                        celebrating={justSolved === p.id}
                      />
                    </td>
                    <td className="cell-feedback" data-label="Feedback">
                      <FeedbackButton
                        hasFeedback={Boolean(feedback[p.id])}
                        onClick={() => setFeedbackFor(p)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {feedbackFor && (
        <FeedbackModal
          problem={feedbackFor}
          existing={feedback[feedbackFor.id] || null}
          isAdmin={isAdmin}
          onSubmit={submitFeedback}
          onDelete={deleteFeedback}
          onError={(err) => showToast(`Save failed: ${err.message}`, "error")}
          onClose={() => setFeedbackFor(null)}
        />
      )}
      {toast && <div className={`toast toast-${toast.kind}`} role="status">{toast.msg}</div>}
    </>
  );
}
