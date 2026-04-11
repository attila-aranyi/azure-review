const API_URL_KEY = "api_url";
const PAT_KEY = "pat";

export function getApiUrl(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(API_URL_KEY) ?? "";
}

export function setApiUrl(url: string): void {
  sessionStorage.setItem(API_URL_KEY, url.replace(/\/+$/, ""));
}

export function getPat(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(PAT_KEY) ?? "";
}

export function setPat(pat: string): void {
  sessionStorage.setItem(PAT_KEY, pat);
}

export function isAuthenticated(): boolean {
  return !!getApiUrl() && !!getPat();
}

export function logout(): void {
  sessionStorage.removeItem(API_URL_KEY);
  sessionStorage.removeItem(PAT_KEY);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = getApiUrl();
  const pat = getPat();
  if (!url || !pat) throw new Error("Not authenticated");

  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pat}`,
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }

  return res.json();
}

// ── Tenant ──
export const api = {
  getTenant: () => apiFetch<{ id: string; adoOrgId: string; status: string; plan: string }>("/api/tenants/me"),

  getTenantStatus: () =>
    apiFetch<{ id: string; status: string; projectCount: number; reviewCount: number }>("/api/tenants/me/status"),

  // ── Reviews ──
  listReviews: (params?: { page?: number; limit?: number; projectId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.projectId) qs.set("projectId", params.projectId);
    return apiFetch<{ data: Review[]; total: number; page: number; limit: number }>(`/api/reviews?${qs}`);
  },

  getReview: (id: string) => apiFetch<ReviewDetail>(`/api/reviews/${id}`),

  retriggerReview: (id: string) => apiFetch<{ ok: true }>(`/api/reviews/${id}/retrigger`, { method: "POST" }),

  submitFeedback: (reviewId: string, findingId: string, vote: "up" | "down", comment?: string) =>
    apiFetch<{ ok: true; feedbackId: string }>(`/api/reviews/${reviewId}/findings/${findingId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ vote, comment }),
    }),

  // ── Usage ──
  getUsage: (year?: number, month?: number) => {
    const qs = new URLSearchParams();
    if (year) qs.set("year", String(year));
    if (month) qs.set("month", String(month));
    return apiFetch<UsageSummary>(`/api/usage?${qs}`);
  },

  getDailyUsage: (year: number, month: number) =>
    apiFetch<{ days: DailyUsage[] }>(`/api/usage/daily?year=${year}&month=${month}`),

  getIssueTypes: () =>
    apiFetch<{ issueTypes: { name: string; value: number }[] }>("/api/usage/issue-types"),

  // ── Config ──
  getConfig: () => apiFetch<TenantConfig>("/api/config"),
  updateConfig: (data: Partial<TenantConfig>) => apiFetch<TenantConfig>("/api/config", { method: "PUT", body: JSON.stringify(data) }),

  getRepoConfig: (repoId: string) => apiFetch<{ overrides: RepoConfig | null }>(`/api/repos/${repoId}/config`),
  getEffectiveConfig: (repoId: string) => apiFetch<{ config: TenantConfig }>(`/api/repos/${repoId}/config/effective`),
  updateRepoConfig: (repoId: string, data: Partial<RepoConfig>) =>
    apiFetch<unknown>(`/api/repos/${repoId}/config`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRepoConfig: (repoId: string) => apiFetch<{ ok: true }>(`/api/repos/${repoId}/config`, { method: "DELETE" }),

  // ── LLM Config ──
  getLlmStatus: () => apiFetch<{ mode: string; provider?: string }>("/api/config/llm-status"),
  setLlmKey: (provider: string, apiKey: string, endpoint?: string) =>
    apiFetch<{ ok: true }>("/api/config/llm-key", { method: "PUT", body: JSON.stringify({ provider, apiKey, endpoint }) }),
  deleteLlmKey: () => apiFetch<{ ok: true }>("/api/config/llm-key", { method: "DELETE" }),

  // ── Rules ──
  listRules: () => apiFetch<{ rules: ReviewRule[] }>("/api/rules"),
  createRule: (rule: NewRule) => apiFetch<{ rule: ReviewRule }>("/api/rules", { method: "POST", body: JSON.stringify(rule) }),
  updateRule: (id: string, data: Partial<NewRule>) =>
    apiFetch<{ rule: ReviewRule }>(`/api/rules/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteRule: (id: string) => apiFetch<{ ok: true }>(`/api/rules/${id}`, { method: "DELETE" }),

  listRepoRules: (repoId: string) => apiFetch<{ rules: ReviewRule[] }>(`/api/repos/${repoId}/rules`),
  createRepoRule: (repoId: string, rule: NewRule) =>
    apiFetch<{ rule: ReviewRule }>(`/api/repos/${repoId}/rules`, { method: "POST", body: JSON.stringify(rule) }),
  getEffectiveRules: (repoId: string) => apiFetch<{ rules: ReviewRule[] }>(`/api/repos/${repoId}/rules/effective`),

  // ── Projects ──
  listProjects: () => apiFetch<{ projects: Project[] }>("/api/projects"),

  // ── Audit Export ──
  exportAudit: (from: string, to: string, format: "json" | "csv") =>
    apiFetch<unknown>(`/api/export/audit?from=${from}&to=${to}&format=${format}`),

  // ── Graph (Axon proxy) ──
  getGraph: (repoId: string) => apiFetch<GraphData>(`/api/repos/${repoId}/graph`),
  getImpact: (repoId: string, symbol: string) => apiFetch<ImpactData>(`/api/repos/${repoId}/graph/impact/${encodeURIComponent(symbol)}`),
  getDeadCode: (repoId: string) => apiFetch<DeadCodeData>(`/api/repos/${repoId}/graph/dead-code`),
};

// ── Types ──
export type Review = {
  id: string;
  tenantId: string;
  repoId: string;
  adoProjectId?: string;
  prId: number;
  status: string;
  hunksProcessed?: number;
  createdAt: string;
  completedAt?: string;
};

export type Finding = {
  id: string;
  issueType: string;
  severity: string;
  filePath: string;
  startLine: number;
  endLine: number;
  message: string;
  suggestion?: string;
  status: string;
};

export type ReviewDetail = Review & { findings: Finding[] };

export type UsageSummary = {
  usage: {
    reviewCount: number;
    findingsCount: number;
    tokensUsed: number;
    llmCostCents: number;
  };
  limits: { maxReviewsPerMonth: number; maxTokensPerMonth: number } | null;
  plan: string;
};

export type DailyUsage = {
  date: string;
  reviewCount: number;
  findingsCount: number;
  tokensUsed: number;
  llmCostCents: number;
};

export type TenantConfig = {
  reviewStrictness: string;
  maxFiles: number;
  maxDiffSize: number;
  enableA11yText: boolean;
  enableA11yVisual: boolean;
  enableSecurity: boolean;
  commentStyle: string;
  minSeverity: string;
};

export type RepoConfig = Partial<TenantConfig> & { enableAxon?: boolean };

export type ReviewRule = {
  id: string;
  tenantId: string;
  adoRepoId: string | null;
  name: string;
  description: string;
  category: string;
  severity: string;
  fileGlob: string | null;
  instruction: string;
  exampleGood: string | null;
  exampleBad: string | null;
  enabled: boolean;
};

export type NewRule = Omit<ReviewRule, "id" | "tenantId" | "adoRepoId" | "createdAt" | "updatedAt">;

export type Project = {
  id: string;
  adoProjectId: string;
  adoProjectName?: string;
  status: string;
};

export type GraphData = {
  nodes: {
    id: string;
    label: string;
    type: string;
    file: string;
    cluster?: number;
    isDead?: boolean;
    deadConfidence?: "high" | "medium" | "low";
    deadReason?: string;
    safeToDelete?: boolean;
  }[];
  edges: { source: string; target: string; type: string }[];
  clusters: { id: number; size: number }[];
};

export type ImpactData = {
  symbol: string;
  blastRadius: { id: string; label: string; depth: number }[];
};

export type DeadCodeData = {
  deadSymbols: {
    file: string;
    name: string;
    type: string;
    confidence: "high" | "medium" | "low";
    reason: string;
    safeToDelete: boolean;
    line?: number;
  }[];
};
