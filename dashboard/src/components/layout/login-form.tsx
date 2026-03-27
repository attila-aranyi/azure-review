"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

export function LoginForm() {
  const { login } = useAuth();
  const [url, setUrl] = useState("");
  const [pat, setPat] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const baseUrl = url.replace(/\/+$/, "");

      // Try auth directly — if CORS blocks /health, this will also fail
      // but gives a clearer error message
      const authRes = await fetch(`${baseUrl}/api/tenants/me`, {
        headers: { Authorization: `Bearer ${pat}` },
      }).catch(() => null);

      if (!authRes) {
        throw new Error("Cannot reach service. Check the URL and ensure CORS is configured (CORS_ORIGINS env var on the backend).");
      }
      if (authRes.status === 401) {
        throw new Error("Authentication failed. Check your PAT has the correct scopes.");
      }
      if (!authRes.ok) {
        throw new Error(`Service returned ${authRes.status}. Check the URL.`);
      }

      login(baseUrl, pat);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-6 p-8 rounded-xl border border-zinc-800 bg-zinc-900">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Code Review</h1>
          <p className="text-sm text-zinc-400 mt-1">Connect to your review service</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Service URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://ca-llm-review-demo.....azurecontainerapps.io"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">Personal Access Token</label>
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="Azure DevOps PAT"
              required
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Connecting..." : "Connect"}
        </button>
      </form>
    </div>
  );
}
