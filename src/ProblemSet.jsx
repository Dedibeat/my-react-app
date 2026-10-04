import { useState, useMemo, useEffect } from 'react';
import './ProblemSet.css';
import { parseSearch, evalSearchAst } from './search.js';
import FeedbackModal from './FeedbackModal.jsx';
import { ProgressSummary, RatingBadge, StatusEditor, FeedbackButton, ContestLink, TagPeek } from './problemUI.jsx';
import { useProblemActions } from './useProblemActions.js';

const RENDER_CAP = 500;

// useState that survives leaving the page (and reloads) within the browser tab,
// so filters aren't lost when you open Profile or Lists and come back.
function useSessionState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = sessionStorage.getItem(key);
      return saved != null ? JSON.parse(saved) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  }, [key, value]);
  return [value, setValue];
}

function Controls(props) {
  const {
    showTag, setShowTag,
    filter, setFilter,
    sort, setSort,
    region, setRegion, regions,
    ratingMin, setRatingMin, ratingMax, setRatingMax,
    searchInput, setSearchInput, onCommitSearch,
    onPick,
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
          <option value="unsolved">Attempted</option>
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

      <button id="toggle-tags" className="btn" onClick={() => setShowTag(!showTag)}>
        {showTag ? 'Hide tags' : 'Show tags'}
      </button>

      <button
        type="button"
        className="btn pick-btn"
        onClick={onPick}
        aria-label="Random unsolved problem"
        title="Random unsolved problem from the current filters"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" />
          <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

function PickCard({ problem, updateStatus, justSolved, onAgain, onClose }) {
  return (
    <div className="pick-card" role="region" aria-label="Random pick">
      <span className="pick-label">Random pick</span>
      <a className="problem-link pick-name" href={problem.url} target="_blank" rel="noopener noreferrer">
        {problem.name}
      </a>
      <TagPeek key={problem.id} tags={problem.tagList} />
      <span className="pick-contest"><ContestLink problem={problem} /></span>
      <RatingBadge rating={problem.rating} />
      <span className="pick-status">
        <StatusEditor
          value={problem.status}
          onChange={(s) => updateStatus(problem.id, s)}
          celebrating={justSolved === problem.id}
        />
      </span>
      <span className="modal-spacer" />
      <button type="button" className="btn" onClick={onAgain}>Another</button>
      <button type="button" className="btn btn-icon pick-close" onClick={onClose} aria-label="Close" title="Close">×</button>
    </div>
  );
}

function ProblemsTable({
  showTag, problems, capped, updateStatus, justSolved, feedback,
  onOpenFeedback,
}) {
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
            <th data-label="ID">ID</th>
            <th data-label="Contest">Contest</th>
            <th data-label="Problem">Problem</th>
            <th data-label="Tags">Tags</th>
            <th data-label="Rating">Rating</th>
            <th title="Click a cell to edit" data-label="Status">Status</th>
            <th aria-label="Feedback" data-label="Feedback" />
          </tr>
        </thead>
        <tbody>
          {problems.length === 0 && (
            <tr className="empty-row">
              <td colSpan={7}>No problems match your filters.</td>
            </tr>
          )}
          {capped.map((p) => (
            <tr key={p.id} className={p.status === "AC" ? "row-solved" : ""}>
              <td className="cell-id" data-label="ID">{p.id}</td>
              <td data-label="Contest"><ContestLink problem={p} /></td>
              <td data-label="Problem">
                <a className="problem-link" href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
                {!showTag && <TagPeek tags={p.tagList} />}
              </td>
              <td data-label="Tags">
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

export default function ProblemSet({ problems, setProblems, loaded, isAdmin }) {
  const [showTag, setShowTag] = useSessionState("pset.ps.showTag", false);
  const [filter, setFilter] = useSessionState("pset.ps.filter", "all");
  const [sort, setSort] = useSessionState("pset.ps.sort", "rating_desc");
  const [committedSearch, setCommittedSearch] = useSessionState("pset.ps.search", "");
  const [searchInput, setSearchInput] = useState(committedSearch);
  const [region, setRegion] = useSessionState("pset.ps.region", "all");
  const [ratingMin, setRatingMin] = useSessionState("pset.ps.ratingMin", null);
  const [ratingMax, setRatingMax] = useSessionState("pset.ps.ratingMax", null);
  const [pickedId, setPickedId] = useState(null);

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

    if (ratingMin != null) {
      list = list.filter((p) => p.rating >= ratingMin);
    }
    if (ratingMax != null) {
      list = list.filter((p) => p.rating != null && p.rating <= ratingMax);
    }

    if (filter === "solved") {
      list = list.filter((p) => p.status === "AC");
    } else if (filter === "unsolved") {
      list = list.filter((p) => p.status && p.status !== "AC" && p.status !== "No submission");
    } else if (filter === "no submission") {
      list = list.filter((p) => !p.status);
    }

    if (searchAst) {
      const hay = (p) => `${p.id} ${p.name} ${p.searchKey} ${p.tags}`.toLowerCase();
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
  }, [problems, filter, sort, region, ratingMin, ratingMax, searchAst]);

  const capped = visible.slice(0, RENDER_CAP);
  const visibleSolved = visible.reduce((n, p) => n + (p.status === "AC" ? 1 : 0), 0);
  const picked = pickedId ? problems.find((p) => p.id === pickedId) : null;

  function pickRandom() {
    const pool = visible.filter((p) => p.status !== "AC" && p.id !== pickedId);
    if (pool.length === 0) {
      showToast("No other unsolved problem matches these filters", "error");
      return;
    }
    setPickedId(pool[Math.floor(Math.random() * pool.length)].id);
  }

  return (
    <>
      <ProgressSummary
        solved={solvedCount}
        total={problems.length}
        visibleCount={visible.length}
        visibleSolved={visibleSolved}
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
        ratingMin={ratingMin}
        setRatingMin={setRatingMin}
        ratingMax={ratingMax}
        setRatingMax={setRatingMax}
        onPick={pickRandom}
      />
      {picked && (
        <PickCard
          problem={picked}
          updateStatus={updateStatus}
          justSolved={justSolved}
          onAgain={pickRandom}
          onClose={() => setPickedId(null)}
        />
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
      {toast && <div className={`toast toast-${toast.kind}`} role="status">{toast.msg}</div>}
    </>
  );
}
