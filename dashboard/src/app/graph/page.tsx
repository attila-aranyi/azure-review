"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { api, type GraphData, type ImpactData } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, Text } from "@tremor/react";
import { Search, Crosshair, Skull, RotateCcw, GitBranch } from "lucide-react";
import dynamic from "next/dynamic";

const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), { ssr: false });

// Colors by symbol type
const TYPE_COLORS: Record<string, string> = {
  function: "#3b82f6",    // blue
  method: "#8b5cf6",      // purple
  class: "#ec4899",       // pink
  interface: "#06b6d4",   // cyan
  type_alias: "#10b981",  // emerald
  enum: "#f97316",        // orange
};

// Colors by edge type
const EDGE_COLORS: Record<string, string> = {
  calls: "#6366f1",       // indigo
  imports: "#10b981",     // emerald
  extends: "#f59e0b",     // amber
  implements: "#06b6d4",  // cyan
  uses_type: "#8b5cf6",   // purple
  coupled_with: "#ef4444",// red
};

const DEAD_COLORS: Record<string, string> = {
  high: "#ef4444",   // red
  medium: "#f97316", // orange
  low: "#eab308",    // yellow
};

function buildElements(graph: GraphData, showDead: boolean, impactSymbols: Set<string>) {
  // Count degree (connections) per node
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...degree.values());

  const nodes = graph.nodes.map((n) => {
    const d = degree.get(n.id) ?? 0;
    const size = 12 + (d / maxDegree) * 48;
    const isDead = showDead && !!n.isDead;
    const deadConf = n.deadConfidence ?? "low";
    return {
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        file: n.file,
        cluster: n.cluster ?? 0,
        degree: d,
        nodeSize: isDead ? Math.max(size, 18) : size,
        nodeColor: isDead ? DEAD_COLORS[deadConf] : (TYPE_COLORS[n.type] ?? "#3b82f6"),
        isDead,
        deadConfidence: deadConf,
        deadReason: n.deadReason ?? "",
        safeToDelete: n.safeToDelete ?? false,
        isImpacted: impactSymbols.has(n.id),
      },
    };
  });

  const edges = graph.edges.map((e, i) => ({
    data: {
      id: `e${i}`,
      source: e.source,
      target: e.target,
      type: e.type,
      edgeColor: EDGE_COLORS[e.type] ?? "#3f3f46",
    },
  }));

  return [...nodes, ...edges];
}

const cytoscapeStylesheet = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "font-size": "9px",
      color: "#d4d4d8",
      "text-valign": "bottom" as const,
      "text-margin-y": 4,
      "text-outline-color": "#18181b",
      "text-outline-width": 2,
      "background-color": "data(nodeColor)",
      "background-opacity": 0.85,
      width: "data(nodeSize)",
      height: "data(nodeSize)",
      "border-width": 1,
      "border-color": "data(nodeColor)",
      "border-opacity": 0.4,
    },
  },
  {
    selector: "node[degree > 10]",
    style: { "font-size": "11px", "font-weight": "bold" as const, color: "#ffffff" },
  },
  {
    selector: "node[?isDead]",
    style: { "border-width": 3, "border-color": "data(nodeColor)", "background-opacity": 1 },
  },
  {
    selector: "node[?isDead][deadConfidence = 'high']",
    style: { "border-color": "#fca5a5", "border-width": 4 },
  },
  {
    selector: "node[?isDead][?safeToDelete]",
    style: { "border-style": "dashed" as const },
  },
  {
    selector: "node[?isImpacted]",
    style: {
      "background-color": "#f59e0b",
      "border-width": 3,
      "border-color": "#fbbf24",
      "background-opacity": 1,
    },
  },
  {
    selector: "edge",
    style: {
      width: 0.5,
      "line-color": "data(edgeColor)",
      "line-opacity": 0.3,
      "target-arrow-color": "data(edgeColor)",
      "target-arrow-shape": "triangle" as const,
      "arrow-scale": 0.5,
      "curve-style": "bezier" as const,
    },
  },
  {
    selector: "edge[type = 'calls']",
    style: { width: 1, "line-opacity": 0.5 },
  },
  {
    selector: "edge[?isImpacted]",
    style: { "line-color": "#f59e0b", "target-arrow-color": "#f59e0b", width: 2, "line-opacity": 1 },
  },
  {
    selector: "node:active",
    style: { "overlay-color": "#ffffff", "overlay-opacity": 0.15 },
  },
];

function GraphContent() {
  const { authenticated } = useAuth();
  const [repoId, setRepoId] = useState("");
  const [graph, setGraph] = useState<GraphData | null>(null);
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
      const g = await api.getGraph(repoId);
      setGraph(g);
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

  const impactSymbols = new Set(
    impact ? impact.blastRadius.map((s) => s.id) : []
  );

  const elements = graph ? buildElements(graph, showDead, impactSymbols) : [];

  // Dead code stats from graph-embedded data
  const deadNodes = graph?.nodes.filter((n) => n.isDead) ?? [];
  const deadHigh = deadNodes.filter((n) => n.deadConfidence === "high");
  const deadMedium = deadNodes.filter((n) => n.deadConfidence === "medium");
  const deadLow = deadNodes.filter((n) => n.deadConfidence === "low");
  const deadCount = deadNodes.length;

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
          {deadCount > 0 && (
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${
              showDead ? "bg-red-800 text-red-200" : "bg-zinc-700 text-zinc-300"
            }`}>
              {deadCount}
            </span>
          )}
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
        ) : error.includes("404") || error.includes("not indexed") ? (
          <Card className="bg-zinc-900 border-zinc-800 ring-0">
            <div className="flex items-center gap-3 py-4">
              <GitBranch className="h-8 w-8 text-zinc-600" />
              <div>
                <Text className="text-zinc-300 font-medium">Repository Not Indexed</Text>
                <Text className="text-zinc-500 text-sm mt-1">
                  This repository hasn't been indexed by Axon yet. Create a PR to trigger a review, which will
                  automatically index the repository for code graph visualization.
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

      <div className="relative rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden" style={{ height: "calc(100vh - 14rem)" }}>
        {graph ? (
          <>
            <CytoscapeComponent
              elements={filteredElements}
              stylesheet={cytoscapeStylesheet}
              layout={{ name: "cose", animate: false, nodeRepulsion: () => 8000, idealEdgeLength: () => 100, nodeDimensionsIncludeLabels: true } as unknown as cytoscape.LayoutOptions}
              style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0 }}
              cy={(cy) => {
                cyRef.current = cy;
                cy.on("tap", "node", (evt) => {
                  const nodeId = evt.target.id();
                  const label = evt.target.data("label");
                  analyzeImpact(label || nodeId);
                });
              }}
            />
            {/* Dead code summary panel */}
            {showDead && deadCount > 0 && (
              <div className="absolute top-3 right-3 w-80 max-h-[60%] overflow-y-auto bg-zinc-900/95 backdrop-blur-sm rounded-xl border border-zinc-700 shadow-2xl">
                <div className="sticky top-0 bg-zinc-900/95 px-4 py-3 border-b border-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">Dead Code</span>
                    <span className="text-xs text-zinc-400">{deadCount} symbols</span>
                  </div>
                  <div className="flex gap-3 mt-2 text-xs">
                    {deadHigh.length > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                        <span className="text-red-400">{deadHigh.length} high</span>
                      </span>
                    )}
                    {deadMedium.length > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-orange-500" />
                        <span className="text-orange-400">{deadMedium.length} medium</span>
                      </span>
                    )}
                    {deadLow.length > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-yellow-500" />
                        <span className="text-yellow-400">{deadLow.length} low</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="divide-y divide-zinc-800">
                  {[...deadHigh, ...deadMedium, ...deadLow].slice(0, 50).map((n, i) => (
                    <div key={`${n.id}-${i}`} className="px-4 py-2.5 hover:bg-zinc-800/50 cursor-pointer" onClick={() => {
                      const cy = cyRef.current;
                      if (cy) {
                        const node = cy.getElementById(n.id);
                        if (node.length) {
                          cy.animate({ center: { eles: node }, zoom: 2 }, { duration: 300 });
                        }
                      }
                    }}>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: DEAD_COLORS[n.deadConfidence ?? "low"] }} />
                        <span className="text-sm text-white truncate font-mono">{n.label}</span>
                        <span className="text-xs text-zinc-500 ml-auto">{n.type}</span>
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5 truncate pl-4">{n.file}</div>
                      {n.deadReason && (
                        <div className="text-xs mt-0.5 pl-4" style={{ color: DEAD_COLORS[n.deadConfidence ?? "low"] + "cc" }}>
                          {n.deadReason}
                        </div>
                      )}
                      {n.safeToDelete && (
                        <span className="inline-block ml-4 mt-1 text-[10px] px-1.5 py-0.5 rounded bg-red-900/40 text-red-300">safe to delete</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Legend */}
            <div className="absolute bottom-3 left-3 flex items-center gap-4 bg-zinc-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-zinc-800 text-xs text-zinc-400">
              <span className="text-zinc-500 font-medium">Nodes</span>
              {Object.entries(showDead ? DEAD_COLORS : TYPE_COLORS).map(([type, color]) => (
                <span key={type} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  {type.replace("_", " ")}
                </span>
              ))}
            </div>
            <div className="absolute bottom-3 right-3 bg-zinc-900/90 backdrop-blur-sm rounded-lg px-3 py-2 border border-zinc-800 text-xs text-zinc-400">
              {graph.nodes.length} nodes &middot; {graph.edges.length} edges
              {deadCount > 0 && <> &middot; {deadCount} dead</>}
            </div>
          </>
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
