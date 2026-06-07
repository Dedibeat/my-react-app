import { useState } from 'react';
import './ProblemSet.css'
import data from './problems.json'
import { preconnect } from 'react-dom';
function Top()
{
    return (
    <div className="top">
        <h2 style={{ margin: 0 }}>Live Problem Set</h2>
        <div className="stats muted" id="summary">Loading…</div>
    </div>
    );
}

function Controls({showTag, setShowTag})
{
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
  const norm = val / 100;
  const hue = Math.round(norm * 120);
  return (
    <span
        className="difficulty"
        style={{background: `hsl(${hue},70%,85%)`}}
    >{percent}</span>
  );
}
const getStatusClass = (status) => {
    if (status === "AC") return "status-solved";
    if (status === "No submission" || status == "") return "";
    return "status-unsolved";
};
function StatusEditor({ value, onChange })
{
    const statuses = ["AC", "WA", "TL", "RE", "NI", "No submission"];

    const [editing, setEditing] = useState(false);

    if (editing) {
    return (
        <select
        autoFocus
        className="inline-select"
        value={value}
        onChange={(e) => {
            onChange(e.target.value);
            setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        >
        {statuses.map((s) => (
            <option key={s} value={s}>
            {s}
            </option>
        ))}
        </select>
    );
    }
    if(value == "No submission") value = "";
    return (
    <span
        onClick={() => setEditing(true)}
        style={{ display: "grid", justifyItems: "center" }}
    >{value}</span>
    );
}

function ProblemsTable({showTag, problems, updateStatus})
{
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
                <tr key={i}>
                    <td>{p.id}</td>
                    <td>{p.contest}</td>
                    <td><a href = "https://qoj.ac/contest/1966/problem/10402"
                         target="_blank" rel="noopener noreferrer"> {p.name}</a>
                    </td>
                    <td>{p.tags}</td>
                    <td><DifficultyBadge percent={p.difficulty}/></td>
                    <td className={getStatusClass(p.status)}>
                        <StatusEditor
                        value={p.status}
                        onChange={(newStatus) => updateStatus(i, newStatus)}/>
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
    const [problems, setProblems] = useState(data);
    const updateStatus = (index, newStatus) => {
        const copy = [...problems];
        copy[index].status = newStatus;
        setProblems(copy);
    };
    return (
    <div>
        <Top/>
        <Controls showTag={showTag} setShowTag={setShowTag}/>
        <ProblemsTable showTag={showTag} problems = {problems} updateStatus={updateStatus}/>
    </div>
    );
}