"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type UsageSummary, type DailyUsage } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, Text, BarChart, AreaChart, Flex, ProgressBar } from "@tremor/react";
import { Download } from "lucide-react";

function UsageContent() {
  const { authenticated } = useAuth();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const [exporting, setExporting] = useState(false);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  useEffect(() => {
    if (!authenticated) return;
    Promise.all([
      api.getUsage(year, month).catch(() => null),
      api.getDailyUsage(year, month).catch(() => ({ days: [] })),
    ]).then(([u, d]) => {
      setUsage(u);
      setDaily(d?.days ?? []);
      setLoading(false);
    });

    // Default export range: current month
    const firstDay = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
    setExportFrom(firstDay);
    setExportTo(lastDay);
  }, [authenticated, year, month]);

  const handleExport = async (format: "json" | "csv") => {
    setExporting(true);
    try {
      const data = await api.exportAudit(exportFrom, exportTo, format);
      const blob = new Blob(
        [format === "json" ? JSON.stringify(data, null, 2) : String(data)],
        { type: format === "json" ? "application/json" : "text/csv" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${exportFrom}-to-${exportTo}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="text-zinc-400">Loading usage...</div>;

  const chartData = daily.map((d) => ({
    date: d.date.slice(5, 10),
    Reviews: d.reviewCount,
    Findings: d.findingsCount,
    "Tokens (k)": Math.round(d.tokensUsed / 1000),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Usage & Audit</h1>
        <p className="text-sm text-zinc-400 mt-1">
          {new Date(year, month - 1).toLocaleString("default", { month: "long", year: "numeric" })}
        </p>
      </div>

      {usage && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-zinc-900 border-zinc-800 ring-0">
            <Text className="text-zinc-400">Reviews</Text>
            <p className="text-2xl font-bold text-white mt-1">{usage.reviewCount}</p>
            {usage.plan?.maxReviewsPerMonth > 0 && (
              <ProgressBar value={(usage.reviewCount / usage.plan.maxReviewsPerMonth) * 100} className="mt-2" />
            )}
          </Card>
          <Card className="bg-zinc-900 border-zinc-800 ring-0">
            <Text className="text-zinc-400">Findings</Text>
            <p className="text-2xl font-bold text-white mt-1">{usage.findingsCount}</p>
          </Card>
          <Card className="bg-zinc-900 border-zinc-800 ring-0">
            <Text className="text-zinc-400">Tokens</Text>
            <p className="text-2xl font-bold text-white mt-1">{Math.round(usage.tokensUsed / 1000)}k</p>
            {usage.plan?.maxTokensPerMonth > 0 && (
              <ProgressBar value={(usage.tokensUsed / usage.plan.maxTokensPerMonth) * 100} className="mt-2" />
            )}
          </Card>
          <Card className="bg-zinc-900 border-zinc-800 ring-0">
            <Text className="text-zinc-400">LLM Cost</Text>
            <p className="text-2xl font-bold text-white mt-1">${(usage.llmCostCents / 100).toFixed(2)}</p>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <Text className="text-zinc-400 mb-4">Daily Reviews & Findings</Text>
          {chartData.length > 0 ? (
            <BarChart
              className="h-56"
              data={chartData}
              index="date"
              categories={["Reviews", "Findings"]}
              colors={["blue", "amber"]}
              showLegend
              showGridLines={false}
            />
          ) : (
            <p className="text-zinc-500 text-sm">No data for this month</p>
          )}
        </Card>

        <Card className="bg-zinc-900 border-zinc-800 ring-0">
          <Text className="text-zinc-400 mb-4">Token Usage Trend</Text>
          {chartData.length > 0 ? (
            <AreaChart
              className="h-56"
              data={chartData}
              index="date"
              categories={["Tokens (k)"]}
              colors={["emerald"]}
              showLegend
              showGridLines={false}
            />
          ) : (
            <p className="text-zinc-500 text-sm">No data for this month</p>
          )}
        </Card>
      </div>

      <Card className="bg-zinc-900 border-zinc-800 ring-0">
        <Text className="text-zinc-400 mb-4">Audit Log Export</Text>
        <div className="flex items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">From</label>
            <input
              type="date"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">To</label>
            <input
              type="date"
              value={exportTo}
              onChange={(e) => setExportTo(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none"
            />
          </div>
          <button
            onClick={() => handleExport("json")}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:text-white transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> JSON
          </button>
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:text-white transition-colors"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </Card>
    </div>
  );
}

export default function UsagePage() {
  return (
    <AppShell>
      <UsageContent />
    </AppShell>
  );
}
