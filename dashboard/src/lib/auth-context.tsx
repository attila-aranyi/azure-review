"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { isAuthenticated, setApiUrl, setPat, logout as doLogout, getApiUrl, getPat } from "./api";

type AuthState = {
  authenticated: boolean;
  apiUrl: string;
  login: (url: string, pat: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthState>({
  authenticated: false,
  apiUrl: "",
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [apiUrl, setUrl] = useState("");

  useEffect(() => {
    setAuthenticated(isAuthenticated());
    setUrl(getApiUrl());
  }, []);

  function login(url: string, pat: string) {
    setApiUrl(url);
    setPat(pat);
    setAuthenticated(true);
    setUrl(url);
  }

  function logout() {
    doLogout();
    setAuthenticated(false);
    setUrl("");
  }

  return (
    <AuthContext.Provider value={{ authenticated, apiUrl, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
