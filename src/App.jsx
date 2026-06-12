import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Link, Navigate } from 'react-router-dom';
import './App.css';
import ProblemSet from './ProblemSet.jsx';
import Profile from './Profile.jsx';
import { api, getToken, setToken } from './api.js';

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

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!getToken()) { setAuthLoading(false); return; }
    api.me()
      .then(setUser)
      .catch(() => setToken(""))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) { setProblems([]); setLoaded(false); return; }
    let cancelled = false;
    async function load() {
      const [dataset, statusMap] = await Promise.all([
        fetch("/tagged.json").then((r) => r.json()),
        api.getStatus().catch(() => ({})),
      ]);
      if (cancelled) return;
      const flat = flattenContests(dataset);
      for (const p of flat) {
        const s = statusMap[p.id];
        p.status = s?.status || "";
        p.statusUpdatedAt = s?.updated_at || null;
      }
      setProblems(flat);
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [user]);

  async function submit(e) {
    e.preventDefault();
    setAuthError("");
    setSubmitting(true);
    try {
      const fn = mode === "login" ? api.login : api.signup;
      const { token, user: u } = await fn(username, password);
      setToken(token);
      setUser(u);
      setPassword("");
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function logout() {
    setToken("");
    setUser(null);
  }

  if (authLoading) {
    return (
      <div className="auth-screen">
        <span className="spinner spinner-lg" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-brand">
            <span className="brand-mark">✓</span>
            <span className="auth-brand-name">Live Problem Set</span>
          </div>
          <div>
            <h1 className="auth-title">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
            <p className="auth-subtitle">
              {mode === "login"
                ? "Log in to keep tracking your progress."
                : "Sign up to start tracking solved problems."}
            </p>
          </div>
          <label className="field">
            <span>Username</span>
            <input
              type="text" placeholder="your username" value={username}
              onChange={(e) => setUsername(e.target.value)} required minLength={3}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password" placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)} required minLength={6}
            />
          </label>
          {authError && <div className="auth-error">{authError}</div>}
          <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
            {submitting
              ? (mode === "login" ? "Logging in…" : "Signing up…")
              : (mode === "login" ? "Log in" : "Sign up")}
          </button>
          <button
            type="button" className="auth-switch"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setAuthError(""); }}
          >
            {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <HashRouter>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/" className="brand">
            <span className="brand-mark">✓</span>
            <h1>Live Problem Set</h1>
          </Link>
          <div className="user-area">
            <Link to="/profile" className="user-chip" title="Your profile">
              <span className="user-avatar">{user.username.charAt(0)}</span>
              {user.username}
            </Link>
            <button className="btn" onClick={logout}>Log out</button>
          </div>
        </header>
        <Routes>
          <Route
            path="/"
            element={<ProblemSet problems={problems} setProblems={setProblems} loaded={loaded} />}
          />
          <Route
            path="/profile"
            element={<Profile user={user} problems={problems} loaded={loaded} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </HashRouter>
  );
}
