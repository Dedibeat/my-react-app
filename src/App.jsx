import { useState, useEffect } from 'react';
import './App.css';
import ProblemSet from './ProblemSet.jsx';
import { api, getToken, setToken } from './api.js';

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!getToken()) { setAuthLoading(false); return; }
    api.me()
      .then(setUser)
      .catch(() => setToken(""))
      .finally(() => setAuthLoading(false));
  }, []);

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
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">✓</span>
          <h1>Live Problem Set</h1>
        </div>
        <div className="user-area">
          <span className="user-chip">
            <span className="user-avatar">{user.username.charAt(0)}</span>
            {user.username}
          </span>
          <button className="btn" onClick={logout}>Log out</button>
        </div>
      </header>
      <ProblemSet />
    </div>
  );
}
