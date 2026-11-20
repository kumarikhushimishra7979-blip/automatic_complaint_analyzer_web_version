import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import api, {
  clearStoredToken,
  getStoredToken,
  setStoredToken,
} from '../services/api';

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  is_active: number;
  created_at: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    confirmPassword: string
  ) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const res = await api.get<UserProfile>('/auth/me');
      setUser(res.data);
    } catch {
      clearStoredToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ access_token: string; user: UserProfile }>(
      '/auth/login',
      { email, password }
    );
    setStoredToken(res.data.access_token);
    setUser(res.data.user);
  }, []);

  const register = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      confirmPassword: string
    ) => {
      const res = await api.post<{ access_token: string; user: UserProfile }>(
        '/auth/register',
        {
          username,
          email,
          password,
          confirm_password: confirmPassword,
        }
      );
      setStoredToken(res.data.access_token);
      setUser(res.data.user);
    },
    []
  );

  const logout = useCallback(() => {
    clearStoredToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
