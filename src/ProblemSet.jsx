import { useState, useEffect, useMemo, useRef } from 'react';
import './ProblemSet.css';
import { api } from './api.js';
import { parseSearch, evalSearchAst } from './search.js';
import FeedbackModal from './FeedbackModal.jsx';
import { IMPORTANCE_COLOR, getStatusClass } from './problemMeta.js';

function ProgressSummary({ solved, total, visibleCount, loaded }) {
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
            onClick={() => { setImportanceRange({ min: 1, max: 5 }); setIncludeUnrated(false); }}
            title="Reset to all ratings, unrated excluded"
            disabled={importanceRange.min === 1 && importanceRange.max === 5 && !includeUnrated}
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
          <option value="solve_rate_desc">Solve Rate ↓</option>
          <option value="solve_rate_asc">Solve Rate ↑</option>
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

function DifficultyBadge({ percent }) {
  const val = parseFloat(percent) || 0;
  const norm = Math.max(0, Math.min(1, val / 100));
  const hue = Math.round(norm * 120);
  return (
    <span className="difficulty" style={{ background: `hsl(${hue},70%,85%)` }}>
      {typeof percent === 'number' ? percent.toFixed(2) : percent}
    </span>
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

function ConfettiBurst() {
  return (
    <span className="confetti" aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => <i key={i} />)}
    </span>
  );
}

function StatusEditor({ value, onChange, celebrating }) {
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

function FeedbackButton({ hasFeedback, onClick }) {
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
            <th>Solve Rate</th>
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
              <td><DifficultyBadge percent={p.difficulty} /></td>
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
  const [sort, setSort] = useState("solve_rate_desc");
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [importanceRange, setImportanceRange] = useState({ min: 1, max: 5 });
  const [includeUnrated, setIncludeUnrated] = useState(false);
  const [feedback, setFeedback] = useState({});
  const [feedbackFor, setFeedbackFor] = useState(null);
  const [toast, setToast] = useState(null);
  const [justSolved, setJustSolved] = useState(null);
  const toastTimer = useRef(null);
  const solvedTimer = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api.getFeedback()
      .then((map) => { if (!cancelled) setFeedback(map); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function showToast(msg, kind) {
    setToast({ msg, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  async function updateStatus(id, newStatus) {
    const prev = problems.find((p) => p.id === id);
    const previous = prev?.status || "";
    const previousAt = prev?.statusUpdatedAt || null;
    setProblems((cur) => cur.map((p) => (
      p.id === id ? { ...p, status: newStatus, statusUpdatedAt: new Date().toISOString() } : p
    )));
    if (newStatus === "AC" && previous !== "AC") {
      setJustSolved(id);
      clearTimeout(solvedTimer.current);
      solvedTimer.current = setTimeout(() => setJustSolved(null), 900);
      showToast("Solved! Nice work 🎉", "success");
    }
    try {
      if (newStatus) await api.setStatus(id, newStatus);
      else await api.clearStatus(id);
    } catch (err) {
      setProblems((cur) => cur.map((p) => (
        p.id === id ? { ...p, status: previous, statusUpdatedAt: previousAt } : p
      )));
      setJustSolved(null);
      showToast(`Save failed: ${err.message}`, "error");
    }
  }

  async function submitFeedback(category, comment) {
    const id = feedbackFor.id;
    await api.setFeedback(id, category, comment);
    setFeedback((cur) => ({ ...cur, [id]: { category, comment } }));
    setFeedbackFor(null);
    showToast("Thanks for the feedback!", "success");
  }

  async function deleteFeedback() {
    const id = feedbackFor.id;
    await api.deleteFeedback(id);
    setFeedback((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
    setFeedbackFor(null);
    showToast("Feedback removed", "success");
  }

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

    const solveRate = (p) => Number(p.difficulty) || 0;
    const impRank = (p) => (p.importance in IMPORTANCE_RANK ? IMPORTANCE_RANK[p.importance] : Infinity);

    const sorted = list.slice();
    if (sort === "importance_desc") {
      sorted.sort((a, b) => {
        const d = impRank(b) - impRank(a);
        return d !== 0 ? d : solveRate(b) - solveRate(a);
      });
    } else if (sort === "importance_asc") {
      sorted.sort((a, b) => {
        const d = impRank(a) - impRank(b);
        return d !== 0 ? d : solveRate(a) - solveRate(b);
      });
    } else if (sort === "solve_rate_desc") {
      sorted.sort((a, b) => solveRate(b) - solveRate(a));
    } else if (sort === "solve_rate_asc") {
      sorted.sort((a, b) => solveRate(a) - solveRate(b));
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
