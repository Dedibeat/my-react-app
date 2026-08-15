import { useState, useEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Link, NavLink, Navigate } from 'react-router-dom';
import './App.css';
import ProblemSet from './ProblemSet.jsx';
import Olympiad from './Olympiad.jsx';
import Codeforces from './Codeforces.jsx';
import Lists from './Lists.jsx';
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

      const oly = p.olympiad_techniques || null;
      const olyTechniques = [];
      if (oly && !oly.no_match) {
        for (const t of oly.primary || []) olyTechniques.push({ id: t.id, evidence: t.evidence || '', secondary: false });
        for (const t of oly.secondary || []) olyTechniques.push({ id: t.id, evidence: t.evidence || '', secondary: true });
      }
      const practiceHint = olyTechniques.length > 0 ? (oly.practice_hint || '') : '';
      const olyHay = `${olyTechniques.map((t) => t.id).join(' ')} ${practiceHint}`;

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
        olyTechniques,
        practiceHint,
        olyHay,
        rating: null,
        url: p.problem_url,
        teamsSolved: p.problem_solved_in_contest,
      });
    }
  }
  return out;
}

// Import the user's Codeforces solve/attempt history, then re-read statuses so
// cfProblems reflects exactly what the backend wrote (it preserves existing AC/NI).
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [problems, setProblems] = useState([]);
  const [cfProblems, setCfProblems] = useState([]);
  const [lists, setLists] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [cfLoaded, setCfLoaded] = useState(false);

  async function reloadLists() {
    try { setLists(await api.getLists()); } catch { /* keep the previous list data */ }
  }

  const reloadStatuses = useCallback(async () => {
    try {
      const statusMap = await api.getStatus().catch(() => ({}));
      setProblems((prev) =>
        prev.map((p) => {
          const s = statusMap[p.id];
          return { ...p, status: s?.status || "", statusUpdatedAt: s?.updated_at || null };
        })
      );
      setCfProblems((prev) =>
        prev.map((p) => {
          const s = statusMap[String(p.id)];
          return { ...p, status: s?.status || "", statusUpdatedAt: s?.updated_at || null };
        })
      );
    } catch { /* ignore */ }
  }, []);

  const lastSyncRef = useRef(0);
  const isSyncingRef = useRef(false);

  const backgroundSync = useCallback(async (force = false) => {
    if (!user?.qoj_handle || isSyncingRef.current) return;
    const now = Date.now();
    // Throttle to once every 20 seconds unless forced
    if (!force && now - lastSyncRef.current < 20000) return;
    lastSyncRef.current = now;
    isSyncingRef.current = true;
    try {
      const res = await api.qojSync(user.qoj_handle);
      if (res) {
        await reloadStatuses();
      }
    } catch {
      /* silent background catch */
    } finally {
      isSyncingRef.current = false;
    }
  }, [user, reloadStatuses]);

  // Window focus & tab visibility change listener
  useEffect(() => {
    if (!user?.qoj_handle) return;

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        backgroundSync();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [user, backgroundSync]);

  useEffect(() => {
    if (!getToken()) { setAuthLoading(false); return; }
    api.me()
      .then(setUser)
      .catch(() => setToken(""))
      .finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!user) { setProblems([]); setCfProblems([]); setLists([]); setLoaded(false); setCfLoaded(false); return; }
    let cancelled = false;
    async function load() {
      // 1. Fetch main problemset & statuses first for instant initial rendering
      const [dataset, ratings, statusMap] = await Promise.all([
        fetch("/tagged.json").then((r) => r.json()),
        fetch("/problem_rating.json").then((r) => r.json()),
        api.getStatus().catch(() => ({})),
      ]);
      if (cancelled) return;
      const ratingMap = {};
      for (const r of ratings) ratingMap[String(r.problem_id)] = r.difficulty_cf;
      const flat = flattenContests(dataset);
      for (const p of flat) {
        const s = statusMap[p.id];
        p.status = s?.status || "";
        p.statusUpdatedAt = s?.updated_at || null;
        p.rating = ratingMap[p.id] ?? null;
      }
      setProblems(flat);
      setLoaded(true);
      reloadLists();

      // 2. Fetch Codeforces dataset asynchronously so it does not block initial load
      fetch("/codeforces.json")
        .then((r) => r.json())
        .then((cf) => {
          if (cancelled) return;
          const cfFlat = cf.map((p) => {
            const s = statusMap[String(p.id)];
            return {
              id: String(p.id),
              code: p.code,
              contest: `Codeforces ${p.code}`,
              name: p.name,
              rating: p.rating,
              tags: p.tags.join(', '),
              tagList: p.tags,
              url: p.url,
              status: s?.status || "",
              statusUpdatedAt: s?.updated_at || null,
            };
          });
          setCfProblems(cfFlat);
          setCfLoaded(true);
        })
        .catch(() => {
          if (!cancelled) setCfLoaded(true);
        });

      // 3. Smoothly run background sync for fresh QOJ updates without blocking initial render
      if (user.qoj_handle && !cancelled) {
        backgroundSync(true);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [user, backgroundSync]);

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
          <nav className="app-nav">
            <NavLink to="/" end className="nav-tab">Problem Set</NavLink>
            <NavLink to="/lists" className="nav-tab">Lists</NavLink>
          </nav>
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
            element={
              <ProblemSet
                problems={problems}
                setProblems={setProblems}
                loaded={loaded}
                isAdmin={user.is_admin}
              />
            }
          />
          <Route
            path="/lists"
            element={
              <Lists
                problems={problems}
                setProblems={setProblems}
                cfProblems={cfProblems}
                setCfProblems={setCfProblems}
                loaded={loaded}
                isAdmin={user.is_admin}
                lists={lists}
                reloadLists={reloadLists}
              />
            }
          />
          <Route
            path="/olympiad"
            element={<Olympiad problems={problems} setProblems={setProblems} loaded={loaded} isAdmin={user.is_admin} />}
          />
          <Route
            path="/codeforces"
            element={<Codeforces cfProblems={cfProblems} setCfProblems={setCfProblems} loaded={cfLoaded} isAdmin={user.is_admin} />}
          />
          <Route
            path="/profile"
            element={
              <Profile
                user={user}
                setUser={setUser}
                problems={problems}
                loaded={loaded}
                reloadStatuses={reloadStatuses}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </HashRouter>
  );
}
