import { useState, useMemo } from 'react';
import './ProblemSet.css';
import { parseSearch, evalSearchAst } from './search.js';
import FeedbackModal from './FeedbackModal.jsx';
import AddToListModal from './AddToListModal.jsx';
import { ProgressSummary, RatingBadge, StatusEditor, FeedbackButton } from './problemUI.jsx';
import { useProblemActions } from './useProblemActions.js';

const RENDER_CAP = 500;

function Controls(props) {
  const {
    showTag, setShowTag,
    filter, setFilter,
    sort, setSort,
    region, setRegion, regions,
    contest, setContest, contests,
    ratingMin, setRatingMin, ratingMax, setRatingMax,
    searchInput, setSearchInput, onCommitSearch,
    onAddContest,
  } = props;
  return (
    <div className="controls">
      <label>
        Quick filter:
        <select
          id="filterSelect"
          className="inline-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="solved">Solved</option>
          <option value="unsolved">Unsolved</option>
          <option value="no submission">No submission</option>
        </select>
      </label>

      <label>
        Sort by:
        <select
          id="sortSelect"
          className="inline-select"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="rating_desc">Rating ↓</option>
          <option value="rating_asc">Rating ↑</option>
          <option value="id_asc">ID ↑</option>
        </select>
      </label>

      <label>
        Search:
        <input
          id="searchInput"
          type="search"
          placeholder="name, tags, contest  (and, or, not, ())"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommitSearch(); }}
        />
        <button
          id="searchButton"
          type="button"
          className="btn btn-icon"
          onClick={onCommitSearch}
          aria-label="Search"
          title="Search"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </label>

      <label>
        Region:
        <select
          id="regionSelect"
          className="inline-select"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        >
          <option value="all">All</option>
          {regions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

      <label>
        Contest:
        <select
          id="contestSelect"
          className="inline-select contest-select"
          value={contest}
          onChange={(e) => setContest(e.target.value)}
        >
          <option value="all">All</option>
          {contests.map((c) => (
            <option key={c.key} value={c.key}>{c.contest} · {c.region} ({c.count})</option>
          ))}
        </select>
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

      {contest !== "all" && (
        <button type="button" className="btn" onClick={onAddContest} title="Add every problem of this contest to a list">
          Add contest to list…
        </button>
      )}

      <button id="toggle-tags" className="btn" onClick={() => setShowTag(!showTag)}>
        {showTag ? 'Hide tags' : 'Show tags'}
      </button>
    </div>
  );
}

function ProblemsTable({
  showTag, problems, capped, updateStatus, justSolved, feedback,
  onOpenFeedback, selected, onToggle, onToggleAll,
}) {
  const allSelected = problems.length > 0 && problems.every((p) => selected.has(p.id));
  return (
    <div className="table-card">
      {problems.length > RENDER_CAP && (
        <div className="table-note">
          Showing first {RENDER_CAP} of {problems.length} — refine filters or search to narrow the list.
        </div>
      )}
      <table id="problemsTable" className={showTag ? "" : "tags-hidden"} aria-describedby="summary">
        <thead>
          <tr>
            <th className="cell-check">
              <input
                type="checkbox"
                aria-label="Select all shown"
                checked={allSelected}
                onChange={onToggleAll}
              />
            </th>
            <th style={{ width: 70 }}>ID</th>
            <th>Contest</th>
            <th>Problem</th>
            <th>Tags</th>
            <th>Rating</th>
            <th style={{ width: 180 }} title="Click a cell to edit">Status</th>
            <th style={{ width: 44 }} aria-label="Feedback" />
          </tr>
        </thead>
        <tbody>
          {problems.length === 0 && (
            <tr className="empty-row">
              <td colSpan={8}>No problems match your filters.</td>
            </tr>
          )}
          {capped.map((p) => (
            <tr key={p.id} className={p.status === "AC" ? "row-solved" : ""}>
              <td className="cell-check">
                <input
                  type="checkbox"
                  aria-label={`Select ${p.name}`}
                  checked={selected.has(p.id)}
                  onChange={() => onToggle(p.id)}
                />
              </td>
              <td className="cell-id">{p.id}</td>
              <td>{p.contest}</td>
              <td>
                <a className="problem-link" href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
              </td>
              <td>
                <div className="tags">
                  {p.tagList.map((t, i) => {
                    const isExtra = p.extraTagSet.has(t);
                    return (
                      <span key={i} className="tag" title={isExtra ? 'extra tag' : undefined}>
                        {isExtra ? `*${t}` : t}
                      </span>
                    );
                  })}
                </div>
              </td>
              <td><RatingBadge rating={p.rating} /></td>
              <td className="cell-status">
                <StatusEditor
                  value={p.status}
                  onChange={(newStatus) => updateStatus(p.id, newStatus)}
                  celebrating={justSolved === p.id}
                />
              </td>
              <td className="cell-feedback">
                <FeedbackButton
                  hasFeedback={Boolean(feedback[p.id])}
                  onClick={() => onOpenFeedback(p)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton-row" style={{ width: `${92 - i * 4}%` }} />
      ))}
    </div>
  );
}

export default function ProblemSet({ problems, setProblems, loaded, isAdmin, lists, reloadLists }) {
  const [showTag, setShowTag] = useState(false);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("rating_desc");
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [contest, setContest] = useState("all");
  const [ratingMin, setRatingMin] = useState(null);
  const [ratingMax, setRatingMax] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [addTarget, setAddTarget] = useState(null);

  const {
    feedback, feedbackFor, setFeedbackFor,
    toast, justSolved,
    updateStatus, submitFeedback, deleteFeedback, showToast,
  } = useProblemActions(problems, setProblems);

  const solvedCount = useMemo(
    () => problems.reduce((n, p) => n + (p.status === "AC" ? 1 : 0), 0),
    [problems],
  );

  const regions = useMemo(() => {
    const set = new Set();
    for (const p of problems) if (p.region) set.add(p.region);
    return Array.from(set).sort();
  }, [problems]);

  const contests = useMemo(() => {
    const m = new Map();
    for (const p of problems) {
      const key = `${p.contest}|${p.region}`;
      const c = m.get(key);
      if (c) c.count++;
      else m.set(key, { key, contest: p.contest, region: p.region, count: 1 });
    }
    return Array.from(m.values()).sort((a, b) => a.contest.localeCompare(b.contest));
  }, [problems]);

  const searchAst = useMemo(() => {
    if (!committedSearch.trim()) return null;
    try { return parseSearch(committedSearch); }
    catch { return null; }
  }, [committedSearch]);

  const visible = useMemo(() => {
    let list = problems;

    if (region !== "all") {
      list = list.filter((p) => p.region === region);
    }

    if (contest !== "all") {
      list = list.filter((p) => `${p.contest}|${p.region}` === contest);
    }

    if (ratingMin != null) {
      list = list.filter((p) => p.rating >= ratingMin);
    }
    if (ratingMax != null) {
      list = list.filter((p) => p.rating <= ratingMax);
    }

    if (filter === "solved") {
      list = list.filter((p) => p.status === "AC");
    } else if (filter === "unsolved") {
      list = list.filter((p) => p.status && p.status !== "AC" && p.status !== "No submission");
    } else if (filter === "no submission") {
      list = list.filter((p) => !p.status);
    }

    if (searchAst) {
      const hay = (p) => `${p.name} ${p.searchKey} ${p.tags}`.toLowerCase();
      list = list.filter((p) => evalSearchAst(searchAst, hay(p)));
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
  }, [problems, filter, sort, region, contest, ratingMin, ratingMax, searchAst]);

  const capped = visible.slice(0, RENDER_CAP);

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

  function openAddModal(target) {
    if (target.length === 0) return;
    setAddTarget(target);
  }

  const selectedProblems = useMemo(
    () => problems.filter((p) => selected.has(p.id)),
    [problems, selected],
  );

  return (
    <>
      <ProgressSummary
        solved={solvedCount}
        total={problems.length}
        visibleCount={visible.length}
        loaded={loaded}
      />
      <Controls
        showTag={showTag}
        setShowTag={setShowTag}
        filter={filter}
        setFilter={setFilter}
        sort={sort}
        setSort={setSort}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onCommitSearch={() => setCommittedSearch(searchInput)}
        region={region}
        setRegion={setRegion}
        regions={regions}
        contest={contest}
        setContest={setContest}
        contests={contests}
        ratingMin={ratingMin}
        setRatingMin={setRatingMin}
        ratingMax={ratingMax}
        setRatingMax={setRatingMax}
        onAddContest={() => openAddModal(problems.filter((p) => `${p.contest}|${p.region}` === contest))}
      />
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <button type="button" className="btn btn-primary" onClick={() => openAddModal(selectedProblems)}>
            Add to list…
          </button>
          <button type="button" className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}
      {loaded ? (
        <ProblemsTable
          showTag={showTag}
          problems={visible}
          capped={capped}
          updateStatus={updateStatus}
          justSolved={justSolved}
          feedback={feedback}
          onOpenFeedback={setFeedbackFor}
          selected={selected}
          onToggle={toggleSelected}
          onToggleAll={toggleAllSelected}
        />
      ) : (
        <SkeletonTable />
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
      {addTarget && (
        <AddToListModal
          problems={addTarget}
          lists={lists}
          onClose={() => setAddTarget(null)}
          onSaved={(added, existing) => {
            reloadLists();
            setSelected(new Set());
            showToast(
              existing > 0
                ? `Added ${added} to list (${existing} already in it)`
                : `Added ${added} to list`,
              "success",
            );
          }}
          onError={(err) => showToast(`Add failed: ${err.message}`, "error")}
        />
      )}
      {toast && <div className={`toast toast-${toast.kind}`} role="status">{toast.msg}</div>}
    </>
  );
}
