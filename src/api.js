const TOKEN_KEY = "pset.token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.detail) msg = body.detail;
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  async signup(username, password) {
    return request("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  async login(username, password) {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  async me() {
    return request("/api/auth/me");
  },
  async getStatus() {
    return request("/api/status");
  },
  async setStatus(problemId, status) {
    return request(`/api/status/${encodeURIComponent(problemId)}`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
  },
  async clearStatus(problemId) {
    return request(`/api/status/${encodeURIComponent(problemId)}`, { method: "DELETE" });
  },
};
