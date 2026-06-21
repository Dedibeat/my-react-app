import { useState, useMemo } from 'react';
import './ProblemSet.css';
import './Olympiad.css';
import { parseSearch, evalSearchAst } from './search.js';
import FeedbackModal from './FeedbackModal.jsx';
import { TECHNIQUE_CATEGORY, techniqueCategory } from './problemMeta.js';
import { ProgressSummary, RatingBadge, StatusEditor, FeedbackButton } from './problemUI.jsx';
import { useProblemActions } from './useProblemActions.js';

function TechniquePills({ techniques }) {
  return (
    <div className="tags">
      {techniques.map((t, i) => (
        <span
          key={i}
          className={`tag oly-tag ${t.secondary ? 'oly-tag-secondary' : ''}`}
          style={{ background: TECHNIQUE_CATEGORY[techniqueCategory(t.id)] || undefined }}
          title={t.evidence || undefined}
        >
          {t.id}
        </span>
      ))}
    </div>
  );
}

function Controls(props) {
  const {
    filter, setFilter,
    category, setCategory, categories,
    technique, setTechnique, techniques,
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
        Category:
        <select className="inline-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label>
        Technique:
        <select className="inline-select" value={technique} onChange={(e) => setTechnique(e.target.value)}>
          <option value="all">All</option>
          {techniques.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      <label>
        Sort by:
        <select className="inline-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="technique">Technique A–Z</option>
          <option value="rating_desc">Rating ↓</option>
          <option value="rating_asc">Rating ↑</option>
          <option value="id_asc">ID ↑</option>
        </select>
      </label>

      <label>
        Search:
        <input
          type="search"
          placeholder="name, contest, technique  (and, or, not, ())"
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
    </div>
  );
}

export default function Olympiad({ problems, setProblems, loaded }) {
  const [filter, setFilter] = useState("all");
  const [category, setCategory] = useState("all");
  const [technique, setTechnique] = useState("all");
  const [sort, setSort] = useState("technique");
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");

  const {
    feedback, feedbackFor, setFeedbackFor,
    toast, justSolved,
    updateStatus, submitFeedback, deleteFeedback, showToast,
  } = useProblemActions(problems, setProblems);

  const olyProblems = useMemo(
    () => problems.filter((p) => p.olyTechniques.length > 0),
    [problems],
  );

  const solvedCount = useMemo(
    () => olyProblems.reduce((n, p) => n + (p.status === "AC" ? 1 : 0), 0),
    [olyProblems],
  );

  const categories = useMemo(() => {
    const set = new Set();
    for (const p of olyProblems) for (const t of p.olyTechniques) set.add(techniqueCategory(t.id));
    return Array.from(set).sort();
  }, [olyProblems]);

  // Technique options, narrowed to the selected category.
  const techniques = useMemo(() => {
    const set = new Set();
    for (const p of olyProblems) {
      for (const t of p.olyTechniques) {
        if (category === "all" || techniqueCategory(t.id) === category) set.add(t.id);
      }
    }
    return Array.from(set).sort();
  }, [olyProblems, category]);

  const searchAst = useMemo(() => {
    if (!committedSearch.trim()) return null;
    try { return parseSearch(committedSearch); }
    catch { return null; }
  }, [committedSearch]);

  const visible = useMemo(() => {
    let list = olyProblems;

    if (category !== "all") {
      list = list.filter((p) => p.olyTechniques.some((t) => techniqueCategory(t.id) === category));
    }
    if (technique !== "all") {
      list = list.filter((p) => p.olyTechniques.some((t) => t.id === technique));
    }

    if (filter === "solved") {
      list = list.filter((p) => p.status === "AC");
    } else if (filter === "unsolved") {
      list = list.filter((p) => p.status && p.status !== "AC" && p.status !== "No submission");
    } else if (filter === "no submission") {
      list = list.filter((p) => !p.status);
    }

    if (searchAst) {
      const hay = (p) => `${p.name} ${p.searchKey} ${p.olyHay}`.toLowerCase();
      list = list.filter((p) => evalSearchAst(searchAst, hay(p)));
    }

    const ratingOf = (p) => Number(p.rating) || 0;
    const firstTech = (p) => p.olyTechniques[0]?.id || '';

    const sorted = list.slice();
    if (sort === "technique") {
      sorted.sort((a, b) => firstTech(a).localeCompare(firstTech(b)));
    } else if (sort === "rating_desc") {
      sorted.sort((a, b) => ratingOf(b) - ratingOf(a));
    } else if (sort === "rating_asc") {
      sorted.sort((a, b) => ratingOf(a) - ratingOf(b));
    } else if (sort === "id_asc") {
      sorted.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return sorted;
  }, [olyProblems, filter, category, technique, sort, searchAst]);

  return (
    <>
      <ProgressSummary
        solved={solvedCount}
        total={olyProblems.length}
        visibleCount={visible.length}
        loaded={loaded}
      />
      <Controls
        filter={filter}
        setFilter={setFilter}
        category={category}
        setCategory={(c) => { setCategory(c); setTechnique("all"); }}
        categories={categories}
        technique={technique}
        setTechnique={setTechnique}
        techniques={techniques}
        sort={sort}
        setSort={setSort}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onCommitSearch={() => setCommittedSearch(searchInput)}
      />
      {loaded ? (
        <div className="table-card">
          <table id="problemsTable" className="oly-table" aria-describedby="summary">
            <thead>
              <tr>
                <th style={{ width: 70 }}>ID</th>
                <th>Contest</th>
                <th>Problem</th>
                <th>Techniques</th>
                <th style={{ width: 44 }} aria-label="Practice hint" />
                <th>Rating</th>
                <th style={{ width: 180 }} title="Click a cell to edit">Status</th>
                <th style={{ width: 44 }} aria-label="Feedback" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr className="empty-row">
                  <td colSpan={8}>No problems match your filters.</td>
                </tr>
              )}
              {visible.map((p) => (
                <tr key={p.id} className={p.status === "AC" ? "row-solved" : ""}>
                  <td className="cell-id">{p.id}</td>
                  <td>{p.contest}</td>
                  <td>
                    <a className="problem-link" href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
                  </td>
                  <td><TechniquePills techniques={p.olyTechniques} /></td>
                  <td className="cell-hint">
                    {p.practiceHint && (
                      <span className="oly-hint" title={p.practiceHint} aria-label="practice hint">💡</span>
                    )}
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
