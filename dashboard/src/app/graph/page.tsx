"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type GraphData, type ImpactData, type DeadCodeData } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, Text } from "@tremor/react";
import { Search, Crosshair, Skull, RotateCcw, GitBranch } from "lucide-react";
import dynamic from "next/dynamic";

const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), { ssr: false });

const CLUSTER_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
];

function buildElements(graph: GraphData, deadSymbols: Set<string>, impactSymbols: Set<string>) {
  const nodes = graph.nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.label,
      type: n.type,
      file: n.file,
      cluster: n.cluster ?? 0,
      isDead: deadSymbols.has(n.id),
      isImpacted: impactSymbols.has(n.id),
    },
  }));

  const edges = graph.edges.map((e, i) => ({
    data: { id: `e${i}`, source: e.source, target: e.target, type: e.type },
  }));

  return [...nodes, ...edges];
}

const cytoscapeStylesheet = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "font-size": "10px",
      color: "#a1a1aa",
      "text-valign": "bottom" as const,
      "text-margin-y": 5,
      "background-color": "#3b82f6",
      width: 20,
      height: 20,
    },
  },
  {
    selector: "node[?isDead]",
    style: { "background-color": "#ef4444", "border-width": 2, "border-color": "#f87171" },
  },
  {
    selector: "node[?isImpacted]",
    style: { "background-color": "#f59e0b", "border-width": 3, "border-color": "#fbbf24", width: 28, height: 28 },
  },
  {
    selector: "edge",
    style: {
      width: 1,
      "line-color": "#3f3f46",
      "target-arrow-color": "#3f3f46",
      "target-arrow-shape": "triangle" as const,
      "curve-style": "bezier" as const,
    },
  },
  {
    selector: "edge[?isImpacted]",
    style: { "line-color": "#f59e0b", "target-arrow-color": "#f59e0b", width: 2 },
  },
];

function GraphContent() {
  const { authenticated } = useAuth();
  const [repoId, setRepoId] = useState("");
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [deadCode, setDeadCode] = useState<DeadCodeData | null>(null);
  const [impact, setImpact] = useState<ImpactData | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDead, setShowDead] = useState(false);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const loadGraph = useCallback(async () => {
    if (!repoId) return;
    setLoading(true);
    setError("");
    try {
      const [g, d] = await Promise.all([
        api.getGraph(repoId),
        api.getDeadCode(repoId).catch(() => null),
      ]);
      setGraph(g);
      setDeadCode(d);
      setImpact(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load graph");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  const analyzeImpact = useCallback(async (symbol: string) => {
    if (!repoId) return;
    try {
      const result = await api.getImpact(repoId, symbol);
      setImpact(result);
    } catch {
      // ignore
    }
  }, [repoId]);

  const deadSymbols = new Set(
    showDead && deadCode ? deadCode.deadSymbols.map((s) => `${s.file}::${s.name}`) : []
  );

  const impactSymbols = new Set(
    impact ? impact.blastRadius.map((s) => s.id) : []
  );

  const elements = graph ? buildElements(graph, deadSymbols, impactSymbols) : [];

  const filteredElements = search
    ? elements.filter((el) => {
        if ("source" in el.data) return true; // keep edges
        return el.data.label?.toLowerCase().includes(search.toLowerCase());
      })
    : elements;

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Code Graph</h1>
          <p className="text-sm text-zinc-400 mt-1">Interactive codebase visualization powered by Axon</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          value={repoId}
          onChange={(e) => setRepoId(e.target.value)}
          placeholder="Repository ID"
          className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-blue-500 outline-none w-72"
        />
        <button
          onClick={loadGraph}
          disabled={!repoId || loading}
          className="px-4 py-1.5 rounded-lg bg-blue-600 text-sm text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Loading..." : "Load Graph"}
        </button>

        <div className="flex-1" />

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter symbols..."
            className="rounded-lg border border-zinc-700 bg-zinc-800 pl-9 pr-3 py-1.5 text-sm text-white placeholder-zinc-500 focus:border-blue-500 outline-none w-48"
          />
        </div>

        <button
          onClick={() => setShowDead(!showDead)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            showDead ? "bg-red-900/50 text-red-400" : "bg-zinc-800 text-zinc-400 hover:text-white"
          }`}
        >
          <Skull className="h-3.5 w-3.5" /> Dead Code
        </button>

        <button
          onClick={() => { setImpact(null); setSearch(""); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      {error && (
        error.includes("503") || error.includes("not configured") ? (
          <Card className="bg-zinc-900 border-zinc-800 ring-0">
            <div className="flex items-center gap-3 py-4">
              <GitBranch className="h-8 w-8 text-zinc-600" />
              <div>
                <Text className="text-zinc-300 font-medium">Axon Code Intelligence Not Configured</Text>
                <Text className="text-zinc-500 text-sm mt-1">
                  The Axon sidecar is required for code graph visualization. Enable it by setting AXON_ENABLED=true
                  and deploying the axon-sidecar container.
                </Text>
              </div>
            </div>
          </Card>
        ) : (
          <p className="text-sm text-red-400">{error}</p>
        )
      )}

      {impact && (
        <Card className="bg-amber-900/20 border-amber-800/50 ring-0 py-2 px-4">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-amber-400" />
            <Text className="text-amber-300">
              Impact analysis: <strong>{impact.symbol}</strong> affects {impact.blastRadius.length} symbols
            </Text>
          </div>
        </Card>
      )}

      <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden" style={{ minHeight: "500px" }}>
        {graph ? (
          <CytoscapeComponent
            elements={filteredElements}
            stylesheet={cytoscapeStylesheet}
            layout={{ name: "cose", animate: false, nodeRepulsion: () => 8000, idealEdgeLength: () => 100 } as unknown as cytoscape.LayoutOptions}
            style={{ width: "100%", height: "100%" }}
            cy={(cy) => {
              cyRef.current = cy;
              cy.on("tap", "node", (evt) => {
                const nodeId = evt.target.id();
                const label = evt.target.data("label");
                analyzeImpact(label || nodeId);
              });
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500">
            Enter a repository ID and click Load Graph to visualize your codebase
          </div>
        )}
      </div>
    </div>
  );
}

export default function GraphPage() {
  return (
    <AppShell>
      <GraphContent />
    </AppShell>
  );
}
