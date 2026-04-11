"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type UsageSummary, type DailyUsage, type Review, type GraphData } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AreaChart, DonutChart, Card, Metric, Text, Flex, ProgressBar, BadgeDelta } from "@tremor/react";
import { Activity, Bug, Shield, Eye, HeartPulse } from "lucide-react";
import Link from "next/link";

function KpiCard({ title, value, icon: Icon, delta }: { title: string; value: string; icon: React.ElementType; delta?: string }) {
  return (
    <Card className="bg-zinc-900 border-zinc-800 ring-0">
      <Flex alignItems="start">
        <div>
          <Text className="text-zinc-400">{title}</Text>
          <Metric className="text-white mt-1">{value}</Metric>
          {delta && <BadgeDelta deltaType="moderateIncrease" className="mt-2">{delta}</BadgeDelta>}
        </div>
        <Icon className="h-8 w-8 text-zinc-600" />
      </Flex>
    </Card>
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

      // Fetch code health from the first repo that has reviews
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
    return <div className="text-zinc-400">Loading dashboard...</div>;
  }

  const issueTypeData = issueTypes;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-zinc-400 mt-1">Overview of your code review activity</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Reviews This Month" value={String(usage?.usage.reviewCount ?? 0)} icon={Activity} />
        <KpiCard title="Findings" value={String(usage?.usage.findingsCount ?? 0)} icon={Bug} />
        <KpiCard title="Tokens Used" value={usage ? `${Math.round((usage.usage.tokensUsed ?? 0) / 1000)}k` : "0"} icon={Eye} />
        <KpiCard title="LLM Cost" value={usage ? `$${((usage.usage.llmCostCents ?? 0) / 100).toFixed(2)}` : "$0.00"} icon={Shield} />
      </div>

      {health && health.dead > 0 && (
        <Link href="/graph">
          <Card className="bg-zinc-900 border-zinc-800 ring-0 hover:border-zinc-600 transition-colors cursor-pointer">
            <Flex alignItems="start">
              <div>
                <Text className="text-zinc-400">Code Health</Text>
                <div className="flex items-baseline gap-3 mt-1">
                  <Metric className="text-white">{health.total - health.dead} <span className="text-base font-normal text-zinc-500">/ {health.total} symbols alive</span></Metric>
                </div>
                <div className="flex gap-4 mt-3 text-xs">
                  {health.high > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-red-400">{health.high} safe to remove</span>
                    </span>
                  )}
                  {health.medium > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                      <span className="text-orange-400">{health.medium} needs investigation</span>
                    </span>
                  )}
                  {health.low > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-yellow-500" />
                      <span className="text-yellow-400">{health.low} likely false positive</span>
                    </span>
                  )}
                </div>
                <ProgressBar
                  value={health.total > 0 ? ((health.total - health.dead) / health.total) * 100 : 100}
                  color="emerald"
                  className="mt-3"
                />
              </div>
              <HeartPulse className="h-8 w-8 text-zinc-600" />
            </Flex>
          </Card>
        </Link>
      )}

      {usage?.limits && (
        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <Text className="text-zinc-400">Plan Usage ({usage.plan})</Text>
          <Flex className="mt-4">
            <Text className="text-zinc-300">Reviews: {usage.usage.reviewCount} / {usage.limits.maxReviewsPerMonth}</Text>
          </Flex>
          <ProgressBar
            value={usage.limits.maxReviewsPerMonth > 0 ? (usage.usage.reviewCount / usage.limits.maxReviewsPerMonth) * 100 : 0}
            className="mt-2"
          />
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <Text className="text-zinc-400 mb-4">Findings Trend (This Month)</Text>
          {daily.length > 0 ? (
            <AreaChart
              className="h-48"
              data={daily.map((d) => ({ date: d.date.slice(5, 10), Findings: d.findingsCount, Reviews: d.reviewCount }))}
              index="date"
              categories={["Findings", "Reviews"]}
              colors={["blue", "emerald"]}
              showLegend
              showGridLines={false}
            />
          ) : (
            <p className="text-zinc-500 text-sm">No data yet</p>
          )}
        </Card>

        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <Text className="text-zinc-400 mb-4">Issue Types (Last 30 Days)</Text>
          {issueTypeData.length > 0 ? (
            <div className="flex items-center gap-6">
              <DonutChart
                className="h-48 w-48 flex-shrink-0"
                data={issueTypeData}
                category="value"
                index="name"
                variant="donut"
                colors={["blue", "cyan", "amber", "red", "rose", "emerald", "violet"]}
                showLabel
                showAnimation
              />
              <div className="flex flex-col gap-1.5 text-xs">
                {issueTypeData.map((item, i) => {
                  const colors = ["#3b82f6", "#06b6d4", "#f59e0b", "#ef4444", "#f43f5e", "#10b981", "#8b5cf6"];
                  return (
                    <span key={item.name} className="flex items-center gap-2 text-zinc-300">
                      <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
                      <span className="capitalize">{item.name}</span>
                      <span className="text-zinc-500 ml-auto">{item.value}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-zinc-500 text-sm">No data yet</p>
          )}
        </Card>
      </div>

      <Card className="bg-zinc-900 border-zinc-800 ring-0">
        <Text className="text-zinc-400 mb-4">Recent Reviews</Text>
        {reviews.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 border-b border-zinc-800">
                <th className="text-left py-2 font-medium">PR</th>
                <th className="text-left py-2 font-medium">Repo</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => (
                <tr key={r.id} className="border-b border-zinc-800/50">
                  <td className="py-2 text-white">#{r.prId}</td>
                  <td className="py-2 text-zinc-300">{r.repoId.slice(0, 8)}...</td>
                  <td className="py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      r.status === "completed" ? "bg-green-900/50 text-green-400" :
                      r.status === "failed" ? "bg-red-900/50 text-red-400" :
                      "bg-yellow-900/50 text-yellow-400"
                    }`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2 text-zinc-400">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-zinc-500 text-sm">No reviews yet. Create a PR to trigger your first review.</p>
        )}
      </Card>
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
