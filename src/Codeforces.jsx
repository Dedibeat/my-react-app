import { useState, useMemo } from 'react';
import './ProblemSet.css';
import './Codeforces.css';
import { parseSearch, evalSearchAst } from './search.js';
import FeedbackModal from './FeedbackModal.jsx';
import { ProgressSummary, RatingBadge, StatusEditor, FeedbackButton } from './problemUI.jsx';
import { useProblemActions } from './useProblemActions.js';

const RENDER_CAP = 500;

function Controls(props) {
  const {
    showTag, setShowTag,
    filter, setFilter,
    tag, setTag, tags,
    sort, setSort,
    searchInput, setSearchInput, onCommitSearch,
  } = props;
  return (
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
        Tag:
        <select className="inline-select" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="all">All</option>
          {tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <label>
        Sort by:
        <select className="inline-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="rating_desc">Rating ↓</option>
          <option value="rating_asc">Rating ↑</option>
          <option value="code_asc">Code ↑</option>
        </select>
      </label>

      <label>
        Search:
        <input
          type="search"
          placeholder="name, code, tags  (and, or, not, ())"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommitSearch(); }}
        />
        <button type="button" className="btn btn-icon" onClick={onCommitSearch} aria-label="Search" title="Search">
          <svg
            xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </label>

      <button className="btn" onClick={() => setShowTag(!showTag)}>
        {showTag ? 'Hide tags' : 'Show tags'}
      </button>
    </div>
  );
}

export default function Codeforces({ cfProblems, setCfProblems, loaded }) {
  const [showTag, setShowTag] = useState(true);
  const [filter, setFilter] = useState("all");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState("rating_desc");
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");

  const {
    feedback, feedbackFor, setFeedbackFor,
    toast, justSolved,
    updateStatus, submitFeedback, deleteFeedback, showToast,
  } = useProblemActions(cfProblems, setCfProblems);

  const solvedCount = useMemo(
    () => cfProblems.reduce((n, p) => n + (p.status === "AC" ? 1 : 0), 0),
    [cfProblems],
  );

  const tags = useMemo(() => {
    const set = new Set();
    for (const p of cfProblems) for (const t of p.tagList) set.add(t);
    return Array.from(set).sort();
  }, [cfProblems]);

  const searchAst = useMemo(() => {
    if (!committedSearch.trim()) return null;
    try { return parseSearch(committedSearch); }
    catch { return null; }
  }, [committedSearch]);

  const visible = useMemo(() => {
    let list = cfProblems;

    if (tag !== "all") {
      list = list.filter((p) => p.tagList.includes(tag));
    }

    if (filter === "solved") {
      list = list.filter((p) => p.status === "AC");
    } else if (filter === "unsolved") {
      list = list.filter((p) => p.status && p.status !== "AC" && p.status !== "No submission");
    } else if (filter === "no submission") {
      list = list.filter((p) => !p.status);
    }

    if (searchAst) {
      const hay = (p) => `${p.name} ${p.code} ${p.tags}`.toLowerCase();
      list = list.filter((p) => evalSearchAst(searchAst, hay(p)));
    }

    const sorted = list.slice();
    if (sort === "rating_desc") {
      sorted.sort((a, b) => b.rating - a.rating);
    } else if (sort === "rating_asc") {
      sorted.sort((a, b) => a.rating - b.rating);
    } else if (sort === "code_asc") {
      sorted.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return sorted;
  }, [cfProblems, filter, tag, sort, searchAst]);

  const capped = visible.slice(0, RENDER_CAP);

  return (
    <>
      <ProgressSummary
        solved={solvedCount}
        total={cfProblems.length}
        visibleCount={visible.length}
        loaded={loaded}
      />
      <Controls
        showTag={showTag}
        setShowTag={setShowTag}
        filter={filter}
        setFilter={setFilter}
        tag={tag}
        setTag={setTag}
        tags={tags}
        sort={sort}
        setSort={setSort}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onCommitSearch={() => setCommittedSearch(searchInput)}
      />
      {loaded ? (
        <div className="table-card">
          {visible.length > RENDER_CAP && (
            <div className="table-note">
              Showing first {RENDER_CAP} of {visible.length} — refine filters or search to narrow the list.
            </div>
          )}
          <table id="problemsTable" className={`cf-table ${showTag ? "" : "tags-hidden"}`} aria-describedby="summary">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Code</th>
                <th>Problem</th>
                <th>Rating</th>
                <th>Tags</th>
                <th style={{ width: 180 }} title="Click a cell to edit">Status</th>
                <th style={{ width: 44 }} aria-label="Feedback" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={6}>No problems match your filters.</td>
                </tr>
              )}
              {capped.map((p) => (
                <tr key={p.id} className={p.status === "AC" ? "row-solved" : ""}>
                  <td className="cell-id">{p.code}</td>
                  <td>
                    <a className="problem-link" href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
                  </td>
                  <td><RatingBadge rating={p.rating} /></td>
                  <td>
                    <div className="tags">
                      {p.tagList.map((t, i) => (
                        <span key={i} className="tag">{t}</span>
                      ))}
                    </div>
                  </td>
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
                      onClick={() => setFeedbackFor(p)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="loading-state">
          <span className="spinner" /> Loading problems…
        </div>
      )}
      {feedbackFor && (
        <FeedbackModal
          problem={feedbackFor}
          existing={feedback[feedbackFor.id] || null}
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
