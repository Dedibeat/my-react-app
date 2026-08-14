const TOKEN_KEY = "pset.token";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  "https://my-react-app-33zw.onrender.com";

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
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.detail) msg = body.detail;
    } catch {
      /* ignore JSON parse error */
    }
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
  async getFeedback() {
    return request("/api/feedback");
  },
  async getAllFeedback(problemId) {
    return request(`/api/feedback/all/${encodeURIComponent(problemId)}`);
  },
  async setFeedback(problemId, category, comment) {
    return request(`/api/feedback/${encodeURIComponent(problemId)}`, {
      method: "PUT",
      body: JSON.stringify({ category, comment }),
    });
  },
  async deleteFeedback(problemId) {
    return request(`/api/feedback/${encodeURIComponent(problemId)}`, { method: "DELETE" });
  },
  async getLists() {
    return request("/api/lists");
  },
  async createList(name) {
    return request("/api/lists", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
  async renameList(id, name) {
    return request(`/api/lists/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  async deleteList(id) {
    return request(`/api/lists/${id}`, { method: "DELETE" });
  },
  async getList(id) {
    return request(`/api/lists/${id}`);
  },
  async addToList(id, problemIds) {
    return request(`/api/lists/${id}/items`, {
      method: "POST",
      body: JSON.stringify({ problem_ids: problemIds }),
    });
  },
  async removeFromList(id, problemIds) {
    return request(`/api/lists/${id}/items`, {
      method: "DELETE",
      body: JSON.stringify({ problem_ids: problemIds }),
    });
  },
  async qojSync(handle, cookies, solved, attempted) {
    return request("/api/qoj-sync", {
      method: "POST",
      body: JSON.stringify({
        handle: handle || undefined,
        cookies: cookies || undefined,
        solved: solved || undefined,
        attempted: attempted || undefined,
      }),
    });
  },
  async getQojStatus() {
    return request("/api/qoj-sync/status");
  },
  async disconnectQoj() {
    return request("/api/qoj-sync", { method: "DELETE" });
  },
};
