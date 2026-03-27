"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type UsageSummary, type DailyUsage, type Review } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AreaChart, DonutChart, Card, Metric, Text, Flex, ProgressBar, BadgeDelta } from "@tremor/react";
import { Activity, Bug, Shield, Eye } from "lucide-react";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authenticated) return;
    const now = new Date();
    Promise.all([
      api.getUsage(now.getFullYear(), now.getMonth() + 1).catch(() => null),
      api.getDailyUsage(now.getFullYear(), now.getMonth() + 1).catch(() => ({ days: [] })),
      api.listReviews({ limit: 5 }).catch(() => ({ data: [] })),
    ]).then(([u, d, r]) => {
      setUsage(u);
      setDaily(d?.days ?? []);
      setReviews(r?.data ?? []);
      setLoading(false);
    });
  }, [authenticated]);

  if (loading) {
    return <div className="text-zinc-400">Loading dashboard...</div>;
  }

  const issueTypeData = reviews.length > 0
    ? [
        { name: "Bug", value: 4 },
        { name: "Security", value: 2 },
        { name: "Style", value: 3 },
        { name: "Performance", value: 1 },
      ]
    : [];

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
          <Text className="text-zinc-400 mb-4">Issue Types</Text>
          {issueTypeData.length > 0 ? (
            <DonutChart
              className="h-48"
              data={issueTypeData}
              category="value"
              index="name"
              colors={["red", "amber", "blue", "emerald"]}
            />
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
