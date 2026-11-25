// ──────────────────────────────────────────────
// CPRecal — API Service Layer
// Connected to real Node.js/Express backend via MongoDB
// ──────────────────────────────────────────────

// REAL BACKEND MODE - Mock data disabled
// All endpoints now call the real Express API backend
const API_BASE = "/api";

// ──── In-Flight Deduplication & Cache ────
const inFlightRequests = new Map();
const cacheMap = new Map();
const CACHE_TTL_MS = 15000; // 15 seconds cache for instant client-side navigation

export function clearApiCache() {
  cacheMap.clear();
}

// ──── HTTP Client ────

async function request(endpoint, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  // Build URL with query params if provided
  let url = `${API_BASE}${endpoint}`;
  if (options.params) {
    const params = new URLSearchParams();
    Object.entries(options.params).forEach(([key, value]) => {
      params.append(key, value);
    });
    url += `?${params}`;
    delete options.params; // Remove params from options
  }

  // Non-GET requests invalidate cache
  if (method !== "GET") {
    clearApiCache();
  } else {
    // Check cache
    const cached = cacheMap.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }

    // Deduplicate identical in-flight GET requests
    if (inFlightRequests.has(url)) {
      return inFlightRequests.get(url);
    }
  }

  const reqPromise = (async () => {
    try {
      const res = await fetch(url, {
        credentials: "include", // Automatically send and receive HTTP-only cookies
        headers: {
          "Content-Type": "application/json",
          ...(localStorage.getItem("cprecall_token")
            ? { Authorization: `Bearer ${localStorage.getItem("cprecall_token")}` }
            : {}),
          ...options.headers,
        },
        ...options,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Automatic retry on 502/504 Bad Gateway (Render cold-start wake-up)
        if ((res.status === 502 || res.status === 504) && !options._isRetry) {
          console.log("[API] Gateway timeout (backend waking up). Retrying in 2.5s...");
          await new Promise((r) => setTimeout(r, 2500));
          return request(endpoint, { ...options, _isRetry: true });
        }

        let errorMsg = data.message;
        if (!errorMsg) {
          if (res.status === 502 || res.status === 504) {
            errorMsg = "Backend server is waking up from idle mode (Render takes ~30-40s on cold start). Please wait a moment and try again.";
          } else {
            errorMsg = `API error: ${res.status} ${res.statusText}`.trim();
          }
        }
        throw new Error(errorMsg);
      }

      if (method === "GET") {
        cacheMap.set(url, { data, timestamp: Date.now() });
      }

      return data;
    } finally {
      if (method === "GET") {
        inFlightRequests.delete(url);
      }
    }
  })();

  if (method === "GET") {
    inFlightRequests.set(url, reqPromise);
  }

  return reqPromise;
}

// ──── Public API Methods ────

export const api = {
  // Auth endpoints
  auth: {
    register: (name, email, password) =>
      request("/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      }),

    login: (email, password) =>
      request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),

    getMe: () => request("/auth/me"),

    logout: () =>
      request("/auth/logout", {
        method: "POST",
      }),
  },

  getDashboard: () => request("/dashboard"),

  getDashboardStats: () => request("/dashboard/stats"),

  getProblems: (filters = {}) => request("/problems", { params: filters }),

  getProblem: (id) => request(`/problems/${id}`),

  getPatterns: () => request("/patterns"),

  getPattern: (id) => request(`/patterns/${id}`),

  submitReview: (problemId, status, satisfiedByProblemId) =>
    request("/reviews", {
      method: "POST",
      body: JSON.stringify({ problemId, status, satisfiedByProblemId }),
    }),

  getRecommendations: () => request("/recommendations"),

  resetProgress: () => request("/progress/reset", { method: "POST" }),

  dismissCompletion: () =>
    request("/progress/dismiss-completion", { method: "POST" }),

  clearCache: clearApiCache,
};

export default api;
