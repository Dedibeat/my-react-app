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
    try {
      const fn = mode === "login" ? api.login : api.signup;
      const { token, user: u } = await fn(username, password);
      setToken(token);
      setUser(u);
      setPassword("");
    } catch (err) {
      setAuthError(err.message);
    }
  }

  function logout() {
    setToken("");
    setUser(null);
  }

  if (authLoading) return <div className="top"><h2 style={{ margin: 0 }}>Loading…</h2></div>;

  if (!user) {
    return (
      <div className="top" style={{ maxWidth: 360 }}>
        <h2 style={{ margin: 0 }}>{mode === "login" ? "Log in" : "Sign up"}</h2>
        <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
          <input
            type="text" placeholder="username" value={username}
            onChange={(e) => setUsername(e.target.value)} required minLength={3}
          />
          <input
            type="password" placeholder="password" value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={6}
          />
          {authError && <div style={{ color: "crimson" }}>{authError}</div>}
          <button className="btn" type="submit">{mode === "login" ? "Log in" : "Sign up"}</button>
          <button
            type="button" className="btn"
            onClick={() => { setMode(mode === "login" ? "signup" : "login"); setAuthError(""); }}
          >
            {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <>
      <div className="top">
        <h2 style={{ margin: 0 }}>Live Problem Set</h2>
        <div>
          <span className="muted">Signed in as <b>{user.username}</b></span>
          {" "}
          <button className="btn" onClick={logout}>Log out</button>
        </div>
      </div>
      <ProblemSet />
    </>
  );
}
