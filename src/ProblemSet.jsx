import { useState, useEffect, useMemo } from 'react';
import './ProblemSet.css';
import { api } from './api.js';
import { parseSearch, evalSearchAst } from './search.js';

function flattenContests(contests) {
  const out = [];
  for (const c of contests) {
    for (const p of c.problems || []) {
      const primaryTags = p.primary_tags || [];
      const secondaryTags = p.secondary_tags || [];
      const extraTags = p.extra_tags || [];
      const tagList = [...primaryTags, ...secondaryTags, ...extraTags];
      const tags = tagList.join(', ');
      const extraTagSet = new Set(extraTags);
      out.push({
        id: String(p.problem_id),
        contest: c.contest_name + ' ' + c.year,
        region: c.region,
        year: c.year,
        searchKey: `${c.region || ''} ${c.contest_name || ''} ${c.year || ''}`,
        name: p.problem_name,
        tags,
        tagList,
        extraTagSet,
        importance: p.importance || '',
        importanceConfidence: typeof p.importance_confidence === 'number' ? p.importance_confidence : 0,
        difficulty: (p.total_number_of_participant > 0
          ? (p.problem_solved_in_contest / p.total_number_of_participant) * 100
          : 0),
        url: p.problem_url,
        teamsSolved: p.problem_solved_in_contest,
      });
    }
  }
  return out;
}

function Top({ total, loaded }) {
  return (
    <div className="top" style={{ marginTop: 12 }}>
      <div />
      <div className="stats muted" id="summary">
        {loaded ? `${total} problems` : 'Loading…'}
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
        <span className="importance-range-label">Importance:&nbsp;P{importanceRange.min}–P{importanceRange.max}</span>
        <div className="importance-range-row">
          <label className="importance-range-half">
            <span className="muted">min</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={importanceRange.min}
              onChange={(e) => {
                const v = Math.min(Number(e.target.value), importanceRange.max);
                setImportanceRange({ ...importanceRange, min: v });
              }}
            />
            <span className="importance-range-value">P{importanceRange.min}</span>
          </label>
          <label className="importance-range-half">
            <span className="muted">max</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={importanceRange.max}
              onChange={(e) => {
                const v = Math.max(Number(e.target.value), importanceRange.min);
                setImportanceRange({ ...importanceRange, max: v });
              }}
            />
            <span className="importance-range-value">P{importanceRange.max}</span>
          </label>
        </div>
        <label className="importance-range-extra">
          <input
            type="checkbox"
            checked={includeUnrated}
            onChange={(e) => setIncludeUnrated(e.target.checked)}
          />
          include unknown / not rated
        </label>
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

const IMPORTANCE_COLOR = {
  p5: 'hsl(0, 75%, 85%)',
  p4: 'hsl(25, 75%, 85%)',
  p3: 'hsl(50, 75%, 85%)',
  p2: 'hsl(85, 60%, 88%)',
  p1: 'hsl(0, 0%, 92%)',
};

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

const getStatusClass = (status) => {
  if (status === "AC") return "status-solved";
  if (status === "No submission" || status === "") return "";
  return "status-unsolved";
};

function StatusEditor({ value, onChange }) {
  const statuses = ["AC", "WA", "TL", "RE", "NI", "No submission"];
  const [editing, setEditing] = useState(false);

  if (editing) {
    const current = value || "No submission";
    return (
      <select
        autoFocus
        className="inline-select"
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
    <span
      onClick={() => setEditing(true)}
      className={value ? "" : "muted"}
      style={{
        display: "grid",
        justifyItems: "center",
        minWidth: 120,
        padding: 8,
        cursor: "pointer",
      }}
    >{value || "—"}</span>
  );
}

function ProblemsTable({ showTag, problems, updateStatus }) {
  return (
    <div style={{ overflow: "auto" }}>
      <table id="problemsTable" className={showTag ? "" : "tags-hidden"} aria-describedby="summary">
        <thead>
          <tr>
            <th style={{ width: 70 }}>ID</th>
            <th>Contest</th>
            <th>Problem</th>
            <th>Tags</th>
            <th>Solve Rate</th>
            <th>Importance</th>
            <th style={{ width: 180 }}>Status (click to edit)</th>
          </tr>
        </thead>
        <tbody>
          {problems.map((p) => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.contest}</td>
              <td>
                <a href={p.url} target="_blank" rel="noopener noreferrer">{p.name}</a>
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
              <td className={getStatusClass(p.status)}>
                <StatusEditor
                  value={p.status}
                  onChange={(newStatus) => updateStatus(p.id, newStatus)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ProblemSet() {
  const [showTag, setShowTag] = useState(false);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("solve_rate_desc");
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [region, setRegion] = useState("all");
  const [importanceRange, setImportanceRange] = useState({ min: 1, max: 5 });
  const [includeUnrated, setIncludeUnrated] = useState(false);
  const [problems, setProblems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [dataset, statusMap] = await Promise.all([
        fetch("/tagged.json").then((r) => r.json()),
        api.getStatus().catch(() => ({})),
      ]);
      if (cancelled) return;
      const flat = flattenContests(dataset);
      for (const p of flat) {
        p.status = statusMap[p.id] || "";
      }
      setProblems(flat);
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function updateStatus(id, newStatus) {
    const previous = problems.find((p) => p.id === id)?.status || "";
    setProblems((cur) => cur.map((p) => (p.id === id ? { ...p, status: newStatus } : p)));
    setSaveError("");
    try {
      if (newStatus) await api.setStatus(id, newStatus);
      else await api.clearStatus(id);
    } catch (err) {
      setProblems((cur) => cur.map((p) => (p.id === id ? { ...p, status: previous } : p)));
      setSaveError(err.message);
    }
  }

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
      <Top total={visible.length} loaded={loaded} />
      {saveError && <div style={{ color: "crimson", margin: "8px 0" }}>Save failed: {saveError}</div>}
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
      <ProblemsTable showTag={showTag} problems={visible} updateStatus={updateStatus} />
    </>
  );
}
