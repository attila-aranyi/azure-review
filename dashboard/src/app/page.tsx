"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type UsageSummary, type DailyUsage, type Review, type GraphData } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { BarChart } from "@tremor/react";
import { Activity, Bug, Eye, HeartPulse, ArrowUpRight, ArrowDownRight } from "lucide-react";
import Link from "next/link";

const ACCENT_COLORS: Record<string, string> = {
  reviews: "#22C55E",
  findings: "#3B82F6",
  tokens: "#8B5CF6",
  cost: "#F59E0B",
};

const ISSUE_COLORS = ["#3b82f6", "#06b6d4", "#f59e0b", "#ef4444", "#f43f5e", "#10b981", "#8b5cf6"];

function KpiCard({ title, value, accent, icon: Icon }: { title: string; value: string; accent: string; icon: React.ElementType }) {
  return (
    <div className="glass-card rounded-xl p-5 relative overflow-hidden group cursor-default">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r" style={{ backgroundColor: accent }} />
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{title}</p>
          <p className="text-2xl font-semibold text-white mt-1.5 tracking-tight">{value}</p>
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: accent + "10" }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
      </div>
    </div>
  );
}

function DashboardContent() {
  const { authenticated } = useAuth();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyUsage[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [health, setHealth] = useState<{ total: number; dead: number; high: number; medium: number; low: number; repoId: string } | null>(null);
  const [issueTypes, setIssueTypes] = useState<{ name: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authenticated) return;
    const now = new Date();
    Promise.all([
      api.getUsage(now.getFullYear(), now.getMonth() + 1).catch(() => null),
      api.getDailyUsage(now.getFullYear(), now.getMonth() + 1).catch(() => ({ daily: [] })),
      api.listReviews({ limit: 5 }).catch(() => ({ data: [] })),
      api.getIssueTypes().catch(() => ({ issueTypes: [] })),
    ]).then(([u, d, r, it]) => {
      setUsage(u);
      setDaily(d?.daily ?? []);
      const revs = r?.data ?? [];
      setReviews(revs);
      setIssueTypes(it?.issueTypes ?? []);
      setLoading(false);

      if (revs.length > 0) {
        const repoId = revs[0].repoId;
        api.getGraph(repoId).then((g: GraphData) => {
          const dead = g.nodes.filter((n) => n.isDead);
          setHealth({
            total: g.nodes.length,
            dead: dead.length,
            high: dead.filter((n) => n.deadConfidence === "high").length,
            medium: dead.filter((n) => n.deadConfidence === "medium").length,
            low: dead.filter((n) => n.deadConfidence === "low").length,
            repoId,
          });
        }).catch(() => {});
      }
    });
  }, [authenticated]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-white/[0.03] rounded-lg animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-white/[0.03] rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  const issueTotal = issueTypes.reduce((s, i) => s + i.value, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Overview of your code review activity</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Reviews This Month" value={String(usage?.usage.reviewCount ?? 0)} accent={ACCENT_COLORS.reviews} icon={Activity} />
        <KpiCard title="Findings" value={String(usage?.usage.findingsCount ?? 0)} accent={ACCENT_COLORS.findings} icon={Bug} />
        <KpiCard title="Tokens Used" value={usage ? `${Math.round((usage.usage.tokensUsed ?? 0) / 1000)}k` : "0"} accent={ACCENT_COLORS.tokens} icon={Eye} />
        <KpiCard title="LLM Cost" value={usage ? `$${((usage.usage.llmCostCents ?? 0) / 100).toFixed(2)}` : "$0.00"} accent={ACCENT_COLORS.cost} icon={ArrowUpRight} />
      </div>

      {/* Code Health */}
      {health && health.dead > 0 && (
        <Link href="/graph" className="block">
          <div className="glass-card rounded-xl p-5 cursor-pointer group">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Code Health</p>
                <div className="flex items-baseline gap-2 mt-1.5">
                  <span className="text-2xl font-semibold text-white tracking-tight">{health.total - health.dead}</span>
                  <span className="text-sm text-slate-500">/ {health.total} symbols alive</span>
                </div>
                <div className="flex gap-5 mt-3">
                  {health.high > 0 && (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      <span className="text-red-400/80">{health.high} safe to remove</span>
                    </span>
                  )}
                  {health.medium > 0 && (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                      <span className="text-orange-400/80">{health.medium} investigate</span>
                    </span>
                  )}
                  {health.low > 0 && (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                      <span className="text-yellow-400/80">{health.low} likely OK</span>
                    </span>
                  )}
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${health.total > 0 ? ((health.total - health.dead) / health.total) * 100 : 100}%` }}
                  />
                </div>
              </div>
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center ml-4">
                <HeartPulse className="h-4 w-4 text-emerald-400" />
              </div>
            </div>
          </div>
        </Link>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Findings Trend — 3 cols */}
        <div className="lg:col-span-3 glass-card rounded-xl p-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-4">Activity Trend</p>
          {daily.length > 0 ? (
            <BarChart
              className="h-44"
              data={daily.map((d) => ({ date: d.date.slice(5, 10), Reviews: d.reviewCount, Findings: d.findingsCount }))}
              index="date"
              categories={["Reviews", "Findings"]}
              colors={["emerald", "blue"]}
              showLegend
              showGridLines={false}
              showAnimation
            />
          ) : (
            <div className="h-44 flex items-center justify-center text-slate-600 text-sm">No activity data yet</div>
          )}
        </div>

        {/* Issue Types — 2 cols, horizontal bars */}
        <div className="lg:col-span-2 glass-card rounded-xl p-5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-4">Issue Types</p>
          {issueTypes.length > 0 ? (
            <div className="space-y-2.5">
              {issueTypes.map((item, i) => {
                const pct = issueTotal > 0 ? (item.value / issueTotal) * 100 : 0;
                const color = ISSUE_COLORS[i % ISSUE_COLORS.length];
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-300 capitalize">{item.name}</span>
                      <span className="text-xs text-slate-500 tabular-nums">{item.value}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-slate-600 text-sm">No findings yet</div>
          )}
        </div>
      </div>

      {/* Recent Reviews */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06]">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Recent Reviews</p>
        </div>
        {reviews.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 border-b border-white/[0.04]">
                <th className="text-left px-5 py-2.5 font-medium text-[11px] uppercase tracking-wider">PR</th>
                <th className="text-left px-5 py-2.5 font-medium text-[11px] uppercase tracking-wider">Repo</th>
                <th className="text-left px-5 py-2.5 font-medium text-[11px] uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-2.5 font-medium text-[11px] uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-3 text-white font-medium">#{r.prId}</td>
                  <td className="px-5 py-3 text-slate-400 font-mono text-xs">{r.repoId.slice(0, 8)}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      r.status === "completed" ? "bg-emerald-500/10 text-emerald-400" :
                      r.status === "failed" ? "bg-red-500/10 text-red-400" :
                      "bg-amber-500/10 text-amber-400"
                    }`}>
                      <span className={`w-1 h-1 rounded-full ${
                        r.status === "completed" ? "bg-emerald-400" :
                        r.status === "failed" ? "bg-red-400" : "bg-amber-400"
                      }`} />
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-5 py-8 text-center text-slate-600 text-sm">
            No reviews yet. Create a PR to trigger your first review.
          </div>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <AppShell>
      <DashboardContent />
    </AppShell>
  );
}
