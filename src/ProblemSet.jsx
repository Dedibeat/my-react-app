import { useState, useEffect } from 'react';
import './ProblemSet.css';
import { api } from './api.js';

function flattenContests(contests) {
  const out = [];
  for (const c of contests) {
    for (const p of c.problems || []) {
      out.push({
        id: String(p.problem_id),
        contest: c.contest_name,
        name: p.problem_name,
        tags: [...(p.primary_tags || []), ...(p.secondary_tags || []), ...(p.extra_tags || [])].join(', '),
        difficulty: p.average_score,
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

function Controls({ showTag, setShowTag }) {
  return (
    <div className="controls">
      <label>
        Quick filter:
        <select id="filterSelect" className="inline-select" defaultValue="all">
          <option value="all">All</option>
          <option value="solved">Solved</option>
          <option value="unsolved">Unsolved</option>
          <option value="no submission">No submission</option>
        </select>
      </label>

      <label>
        Sort by:
        <select id="sortSelect" className="inline-select" defaultValue="difficulty_desc">
          <option value="difficulty_desc">Difficulty ↓</option>
          <option value="difficulty_asc">Difficulty ↑</option>
          <option value="id_asc">ID ↑</option>
        </select>
      </label>

      <label>
        Search:
        <input id="searchInput" type="search" placeholder="name, tags, contest" />
      </label>

      <button id="toggle-tags" className="btn" onClick={() => setShowTag(!showTag)}>
        Show tags
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
      style={{ display: "grid", justifyItems: "center" }}
    >{value || ""}</span>
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
          {problems.map((p, i) => (
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

  return (
    <>
      <Top total={problems.length} loaded={loaded} />
      {saveError && <div style={{ color: "crimson", margin: "8px 0" }}>Save failed: {saveError}</div>}
      <Controls showTag={showTag} setShowTag={setShowTag} />
      <ProblemsTable showTag={showTag} problems={problems} updateStatus={updateStatus} />
    </>
  );
}
