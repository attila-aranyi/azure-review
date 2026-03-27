"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type ReviewRule, type NewRule } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, Text } from "@tremor/react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";

const CATEGORIES = ["naming", "security", "style", "patterns", "documentation"];
const SEVERITIES = ["info", "low", "medium", "high", "critical"];

function RuleForm({ initial, onSave, onCancel }: {
  initial?: ReviewRule;
  onSave: (rule: NewRule) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<NewRule>({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    category: initial?.category ?? "style",
    severity: initial?.severity ?? "medium",
    fileGlob: initial?.fileGlob ?? null,
    instruction: initial?.instruction ?? "",
    exampleGood: initial?.exampleGood ?? null,
    exampleBad: initial?.exampleBad ?? null,
    enabled: initial?.enabled ?? true,
  });

  return (
    <Card className="bg-zinc-900 border-zinc-800 ring-0">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="no-any-type"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Severity</label>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none"
              >
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Description</label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Disallow use of any type in TypeScript"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Instruction</label>
          <textarea
            value={form.instruction}
            onChange={(e) => setForm({ ...form, instruction: e.target.value })}
            placeholder="Flag any use of the any type. Suggest specific types or unknown instead."
            rows={2}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none resize-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">File Glob (optional)</label>
            <input
              value={form.fileGlob ?? ""}
              onChange={(e) => setForm({ ...form, fileGlob: e.target.value || null })}
              placeholder="*.ts"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Good Example (optional)</label>
            <input
              value={form.exampleGood ?? ""}
              onChange={(e) => setForm({ ...form, exampleGood: e.target.value || null })}
              placeholder="const x: string = 'hi'"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Bad Example (optional)</label>
            <input
              value={form.exampleBad ?? ""}
              onChange={(e) => setForm({ ...form, exampleBad: e.target.value || null })}
              placeholder="const x: any = 'hi'"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white focus:border-blue-500 outline-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="rounded"
            />
            Enabled
          </label>
          <div className="flex gap-2">
            <button onClick={onCancel} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-400 hover:text-white transition-colors">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
            <button onClick={() => onSave(form)} className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-700 transition-colors">
              <Check className="h-3.5 w-3.5" /> Save
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function RulesContent() {
  const { authenticated } = useAuth();
  const [rules, setRules] = useState<ReviewRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    api.listRules().then((r) => { setRules(r.rules); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { if (authenticated) load(); }, [authenticated]);

  const handleCreate = async (rule: NewRule) => {
    await api.createRule(rule);
    setCreating(false);
    load();
  };

  const handleUpdate = async (id: string, rule: Partial<NewRule>) => {
    await api.updateRule(id, rule);
    setEditing(null);
    load();
  };

  const handleDelete = async (id: string) => {
    await api.deleteRule(id);
    load();
  };

  if (loading) return <div className="text-zinc-400">Loading rules...</div>;

  const severityColor: Record<string, string> = {
    critical: "text-red-400", high: "text-orange-400", medium: "text-yellow-400", low: "text-blue-400", info: "text-zinc-400",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Custom Rules</h1>
          <p className="text-sm text-zinc-400 mt-1">{rules.length} / 25 tenant-level rules</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          disabled={rules.length >= 25}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Rule
        </button>
      </div>

      {creating && (
        <RuleForm onSave={handleCreate} onCancel={() => setCreating(false)} />
      )}

      {rules.length === 0 && !creating ? (
        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <Text className="text-zinc-500">No custom rules yet. Add rules to enforce your team's coding standards.</Text>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map((rule) =>
            editing === rule.id ? (
              <RuleForm
                key={rule.id}
                initial={rule}
                onSave={(data) => handleUpdate(rule.id, data)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <Card key={rule.id} className="bg-zinc-900 border-zinc-800 ring-0">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-white">{rule.name}</span>
                      <span className={`text-xs font-medium ${severityColor[rule.severity]}`}>{rule.severity}</span>
                      <span className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">{rule.category}</span>
                      {!rule.enabled && <span className="text-xs text-zinc-600">disabled</span>}
                    </div>
                    <p className="text-sm text-zinc-400 mt-1">{rule.description}</p>
                    <p className="text-xs text-zinc-500 mt-1">{rule.instruction}</p>
                  </div>
                  <div className="flex gap-1 ml-4">
                    <button onClick={() => setEditing(rule.id)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(rule.id)} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function RulesPage() {
  return (
    <AppShell>
      <RulesContent />
    </AppShell>
  );
}
