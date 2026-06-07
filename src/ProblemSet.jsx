import { useState, useEffect, useMemo } from 'react';
import './ProblemSet.css';
import { api } from './api.js';
import { parseSearch, evalSearchAst } from './search.js';

function flattenContests(contests) {
  const out = [];
  for (const c of contests) {
    for (const p of c.problems || []) {
      const tags = [...(p.primary_tags || []), ...(p.secondary_tags || []), ...(p.extra_tags || [])].join(', ');
      out.push({
        id: String(p.problem_id),
        contest: c.contest_name,
        region: c.region,
        year: c.year,
        searchKey: `${c.region || ''} ${c.contest_name || ''} ${c.year || ''}`,
        name: p.problem_name,
        tags,
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

      <label>
        Sort by:
        <select
          id="sortSelect"
          className="inline-select"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="difficulty_desc">Difficulty ↓</option>
          <option value="difficulty_asc">Difficulty ↑</option>
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
        <button id="searchButton" type="button" className="btn" onClick={onCommitSearch}>
          Search
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
            <th>Difficulty</th>
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
              <td>{p.tags}</td>
              <td><DifficultyBadge percent={p.difficulty} /></td>
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
  const [sort, setSort] = useState("difficulty_desc");
  const [searchInput, setSearchInput] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [region, setRegion] = useState("all");
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

    const sorted = list.slice();
    if (sort === "difficulty_desc") {
      sorted.sort((a, b) => (Number(b.difficulty) || 0) - (Number(a.difficulty) || 0));
    } else if (sort === "difficulty_asc") {
      sorted.sort((a, b) => (Number(a.difficulty) || 0) - (Number(b.difficulty) || 0));
    } else if (sort === "id_asc") {
      sorted.sort((a, b) => Number(a.id) - Number(b.id));
    }
    return sorted;
  }, [problems, filter, sort, region, searchAst]);

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
