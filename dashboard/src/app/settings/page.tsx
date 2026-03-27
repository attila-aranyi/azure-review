"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type TenantConfig, type Project } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, Text } from "@tremor/react";
import { Save, Key, Trash2 } from "lucide-react";

function SettingsContent() {
  const { authenticated } = useAuth();
  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [llmStatus, setLlmStatus] = useState<{ mode: string; provider?: string } | null>(null);
  const [tenant, setTenant] = useState<{ id: string; adoOrgId: string; plan: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!authenticated) return;
    Promise.all([
      api.getConfig().catch(() => null),
      api.listProjects().catch(() => ({ projects: [] })),
      api.getLlmStatus().catch(() => null),
      api.getTenant().catch(() => null),
    ]).then(([c, p, l, t]) => {
      setConfig(c);
      setProjects(p?.projects ?? []);
      setLlmStatus(l);
      setTenant(t);
      setLoading(false);
    });
  }, [authenticated]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const cleaned = Object.fromEntries(
        Object.entries(config).map(([k, v]) => [k, v === null || v === undefined ? "" : v])
      );
      await api.updateConfig(cleaned as Partial<TenantConfig>);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-zinc-400">Loading settings...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">Configure your review service</p>
      </div>

      {tenant && (
        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <Text className="text-zinc-400 mb-3">Tenant</Text>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><span className="text-zinc-500">Organization:</span> <span className="text-white ml-2">{tenant.adoOrgId}</span></div>
            <div><span className="text-zinc-500">Plan:</span> <span className="text-white ml-2 capitalize">{tenant.plan}</span></div>
            <div><span className="text-zinc-500">ID:</span> <span className="text-zinc-400 ml-2 font-mono text-xs">{tenant.id}</span></div>
          </div>
        </Card>
      )}

      {config && (
        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <div className="flex items-center justify-between mb-4">
            <Text className="text-zinc-400">Review Configuration</Text>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Save className="h-3.5 w-3.5" /> {saving ? "Saving..." : "Save"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Strictness</label>
              <select
                value={config.reviewStrictness}
                onChange={(e) => setConfig({ ...config, reviewStrictness: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none"
              >
                <option value="relaxed">Relaxed</option>
                <option value="balanced">Balanced</option>
                <option value="strict">Strict</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Min Severity</label>
              <select
                value={config.minSeverity}
                onChange={(e) => setConfig({ ...config, minSeverity: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Max Files per PR</label>
              <input
                type="number"
                value={config.maxFiles}
                onChange={(e) => setConfig({ ...config, maxFiles: parseInt(e.target.value) || 20 })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Comment Style</label>
              <select
                value={config.commentStyle}
                onChange={(e) => setConfig({ ...config, commentStyle: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none"
              >
                <option value="inline">Inline</option>
                <option value="summary">Summary</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>
          <div className="flex gap-6 mt-4">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={config.enableSecurity} onChange={(e) => setConfig({ ...config, enableSecurity: e.target.checked })} className="rounded" />
              Security checks
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={config.enableA11yText} onChange={(e) => setConfig({ ...config, enableA11yText: e.target.checked })} className="rounded" />
              Accessibility (text)
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={config.enableA11yVisual} onChange={(e) => setConfig({ ...config, enableA11yVisual: e.target.checked })} className="rounded" />
              Accessibility (visual)
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={(config as Record<string, unknown>).enableAxon as boolean ?? false} onChange={(e) => setConfig({ ...config, enableAxon: e.target.checked } as TenantConfig)} className="rounded" />
              Axon code intelligence
            </label>
          </div>
        </Card>
      )}

      {llmStatus && (
        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <div className="flex items-center gap-2 mb-3">
            <Key className="h-4 w-4 text-zinc-400" />
            <Text className="text-zinc-400">LLM Provider</Text>
          </div>
          <div className="text-sm">
            <span className="text-zinc-500">Mode:</span>
            <span className="text-white ml-2 capitalize">{llmStatus.mode}</span>
            {llmStatus.provider && (
              <><span className="text-zinc-600 mx-2">&middot;</span><span className="text-zinc-300">{llmStatus.provider}</span></>
            )}
          </div>
        </Card>
      )}

      <Card className="bg-zinc-900 border-zinc-800 ring-0">
        <Text className="text-zinc-400 mb-3">Enrolled Projects</Text>
        {projects.length > 0 ? (
          <div className="space-y-2">
            {projects.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
                <div>
                  <span className="text-sm text-white">{p.adoProjectName ?? p.adoProjectId}</span>
                  <span className={`ml-2 text-xs ${p.status === "active" ? "text-green-400" : "text-zinc-500"}`}>{p.status}</span>
                </div>
                <span className="text-xs text-zinc-500 font-mono">{p.adoProjectId}</span>
              </div>
            ))}
          </div>
        ) : (
          <Text className="text-zinc-500 text-sm">No projects enrolled yet.</Text>
        )}
      </Card>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsContent />
    </AppShell>
  );
}
