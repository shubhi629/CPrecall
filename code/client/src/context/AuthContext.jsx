import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("cprecall_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem("cprecall_token") || null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Check current session on application mount
  const checkAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      setAuthError(null);
      const res = await api.auth.getMe();
      if (res && res.user) {
        // Refresh token from /me if server returned one (token rotation)
        if (res.token) {
          localStorage.setItem("cprecall_token", res.token);
          setToken(res.token);
        }
        localStorage.setItem("cprecall_user", JSON.stringify(res.user));
        setUser(res.user);
      } else {
        localStorage.removeItem("cprecall_user");
        localStorage.removeItem("cprecall_token");
        setUser(null);
        setToken(null);
      }
    } catch (err) {
      // If unauthorized (401), clear auth state
      // Otherwise (network error, 5xx) keep cached user so refresh doesn't log user out
      const is401 = err.message && (
        err.message.includes("401") || 
        err.message.toLowerCase().includes("authentication required") ||
        err.message.toLowerCase().includes("session expired") ||
        err.message.toLowerCase().includes("invalid authentication")
      );
      if (is401) {
        localStorage.removeItem("cprecall_user");
        localStorage.removeItem("cprecall_token");
        setUser(null);
        setToken(null);
      }
      // For network errors / 5xx, silently keep cached state
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (email, password) => {
    setAuthError(null);
    try {
      const res = await api.auth.login(email, password);
      if (res.token) {
        localStorage.setItem("cprecall_token", res.token);
        setToken(res.token);
      }
      localStorage.setItem("cprecall_user", JSON.stringify(res.user));
      setUser(res.user);
      return res.user;
    } catch (err) {
      setAuthError(err.message || 'Login failed. Please check your credentials.');
      throw err;
    }
  };

  const register = async (name, email, password) => {
    setAuthError(null);
    try {
      const res = await api.auth.register(name, email, password);
      if (res.token) {
        localStorage.setItem("cprecall_token", res.token);
        setToken(res.token);
      }
      localStorage.setItem("cprecall_user", JSON.stringify(res.user));
      setUser(res.user);
      return res.user;
    } catch (err) {
      setAuthError(err.message || 'Registration failed.');
      throw err;
    }
  };

  // Logout handler
  const logout = async () => {
    try {
      await api.auth.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem("cprecall_token");
      localStorage.removeItem("cprecall_user");
      setToken(null);
      setUser(null);
      setAuthError(null);
    }
  };

  const clearError = () => setAuthError(null);

  const value = {
    user,
    token,
    isAuthenticated: !!user,
    isLoading,
    authError,
    login,
    register,
    logout,
    checkAuth,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
