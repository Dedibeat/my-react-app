import { useState, useMemo } from 'react';
import './ProblemSet.css';
import { parseSearch, evalSearchAst } from './search.js';
import FeedbackModal from './FeedbackModal.jsx';
import { IMPORTANCE_COLOR } from './problemMeta.js';
import { ProgressSummary, RatingBadge, StatusEditor, FeedbackButton } from './problemUI.jsx';
import { useProblemActions } from './useProblemActions.js';

function Controls(props) {
  const {
    showTag, setShowTag,
    filter, setFilter,
    sort, setSort,
    region, setRegion, regions,
    importanceRange, setImportanceRange, includeUnrated, setIncludeUnrated,
    searchInput, setSearchInput, onCommitSearch,
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

      <div className="importance-range">
        <div className="importance-range-head">
          <span className="importance-range-label">Importance</span>
          <button
            type="button"
            className="importance-range-reset"
            onClick={() => { setImportanceRange({ min: 1, max: 5 }); setIncludeUnrated(true); }}
            title="Reset to all ratings, unrated included"
            disabled={importanceRange.min === 1 && importanceRange.max === 5 && includeUnrated}
          >
            reset
          </button>
          <div className="importance-range-slider">
            <div
              className="importance-range-band"
              style={{
                left: `${((importanceRange.min - 1) / 4) * 100}%`,
                right: `${((5 - importanceRange.max) / 4) * 100}%`,
              }}
            />
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={importanceRange.min}
              className="importance-range-thumb importance-range-thumb-min"
              aria-label="Minimum importance"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v > importanceRange.max) {
                  // Pushed past current max: drag both ends along.
                  setImportanceRange({ min: importanceRange.max, max: v });
                } else {
                  setImportanceRange({ ...importanceRange, min: v });
                }
              }}
            />
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={importanceRange.max}
              className="importance-range-thumb importance-range-thumb-max"
              aria-label="Maximum importance"
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v < importanceRange.min) {
                  // Pulled below current min: drag both ends along.
                  setImportanceRange({ min: v, max: importanceRange.min });
                } else {
                  setImportanceRange({ ...importanceRange, max: v });
                }
              }}
            />
          </div>
          <span className="importance-range-pill">
            P{importanceRange.min}–P{importanceRange.max}
          </span>
          <button
            type="button"
            className={`importance-range-unrated ${includeUnrated ? 'on' : ''}`}
            onClick={() => setIncludeUnrated(!includeUnrated)}
            title="Toggle: also include unrated / unknown problems"
          >
            +unrated
          </button>
        </div>
      </div>

      <label>
        Sort by:
        <select
          id="sortSelect"
          className="inline-select"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="importance_desc">Importance ↓</option>
          <option value="importance_asc">Importance ↑</option>
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

      <button id="toggle-tags" className="btn" onClick={() => setShowTag(!showTag)}>
        {showTag ? 'Hide tags' : 'Show tags'}
      </button>
    </div>
  );
}

const IMPORTANCE_RANK = { p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 };

function ImportanceLabel({ value, confidence }) {
  if (!value) {
    return <span className="importance importance-muted" title="not yet rated">*?</span>;
  }
  if (value === 'unknown') {
    return <span className="importance importance-unknown" title="model said unknown">*?</span>;
  }
  const bg = IMPORTANCE_COLOR[value] || 'hsl(0, 0%, 92%)';
  const label = value.toUpperCase();
  const tip = confidence > 0 ? `confidence ${(confidence * 100).toFixed(0)}%` : undefined;
  return <span className="importance" style={{ background: bg }} title={tip}>{label}</span>;
}

function ProblemsTable({ showTag, problems, updateStatus, justSolved, feedback, onOpenFeedback }) {
  return (
    <div className="table-card">
      <table id="problemsTable" className={showTag ? "" : "tags-hidden"} aria-describedby="summary">
        <thead>
          <tr>
            <th style={{ width: 70 }}>ID</th>
            <th>Contest</th>
            <th>Problem</th>
            <th>Tags</th>
            <th>Rating</th>
            <th>Importance</th>
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
          {problems.map((p) => (
            <tr key={p.id} className={p.status === "AC" ? "row-solved" : ""}>
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
              <td><ImportanceLabel value={p.importance} confidence={p.importanceConfidence} /></td>
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

export default function ProblemSet({ problems, setProblems, loaded }) {
  const [showTag, setShowTag] = useState(false);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("rating_desc");
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [importanceRange, setImportanceRange] = useState({ min: 1, max: 5 });
  const [includeUnrated, setIncludeUnrated] = useState(true);

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

    list = list.filter((p) => {
      const rank = p.importance in IMPORTANCE_RANK ? IMPORTANCE_RANK[p.importance] : null;
      if (rank === null) return includeUnrated;
      return rank >= importanceRange.min && rank <= importanceRange.max;
    });

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
    const impRank = (p) => (p.importance in IMPORTANCE_RANK ? IMPORTANCE_RANK[p.importance] : Infinity);

    const sorted = list.slice();
    if (sort === "importance_desc") {
      sorted.sort((a, b) => {
        const d = impRank(b) - impRank(a);
        return d !== 0 ? d : ratingOf(b) - ratingOf(a);
      });
    } else if (sort === "importance_asc") {
      sorted.sort((a, b) => {
        const d = impRank(a) - impRank(b);
        return d !== 0 ? d : ratingOf(a) - ratingOf(b);
      });
    } else if (sort === "rating_desc") {
      sorted.sort((a, b) => ratingOf(b) - ratingOf(a));
    } else if (sort === "rating_asc") {
      sorted.sort((a, b) => ratingOf(a) - ratingOf(b));
    } else if (sort === "id_asc") {
      sorted.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return sorted;
  }, [problems, filter, sort, region, importanceRange, includeUnrated, searchAst]);

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
        importanceRange={importanceRange}
        setImportanceRange={setImportanceRange}
        includeUnrated={includeUnrated}
        setIncludeUnrated={setIncludeUnrated}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onCommitSearch={() => setCommittedSearch(searchInput)}
        region={region}
        setRegion={setRegion}
        regions={regions}
      />
      {loaded ? (
        <ProblemsTable
          showTag={showTag}
          problems={visible}
          updateStatus={updateStatus}
          justSolved={justSolved}
          feedback={feedback}
          onOpenFeedback={setFeedbackFor}
        />
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
