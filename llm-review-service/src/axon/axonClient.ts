/**
 * HTTP client for the axon sidecar service.
 *
 * All methods are fire-and-forget safe — they return null/empty on failure
 * to support graceful degradation.
 */

import type { Logger } from "pino";
import type {
  IndexResult,
  RepoStatus,
  DetectChangesResult,
  ImpactResult,
  SymbolContext,
  DeadCodeResult,
} from "./axonTypes";

const DEFAULT_TIMEOUT_MS = 30_000;
const INDEX_TIMEOUT_MS = 300_000; // 5 minutes for indexing

export interface AxonClientOpts {
  baseUrl: string;
  logger: Logger;
  timeoutMs?: number;
}

export class AxonClient {
  private baseUrl: string;
  private logger: Logger;
  private timeoutMs: number;

  constructor(opts: AxonClientOpts) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.logger = opts.logger.child({ component: "axon-client" });
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Index (clone + analyze) a repository.
   */
  async indexRepo(
    tenantId: string,
    repoId: string,
    cloneUrl: string,
    accessToken: string,
    branch: string = "main",
  ): Promise<IndexResult | null> {
    return this._post<IndexResult>(
      `/repos/${tenantId}/${repoId}/index`,
      { clone_url: cloneUrl, access_token: accessToken, branch },
      INDEX_TIMEOUT_MS,
    );
  }

  /**
   * Reindex (fetch + re-analyze) an already cloned repository.
   */
  async reindexRepo(
    tenantId: string,
    repoId: string,
    accessToken: string,
    branch: string = "main",
  ): Promise<IndexResult | null> {
    return this._post<IndexResult>(
      `/repos/${tenantId}/${repoId}/reindex`,
      { access_token: accessToken, branch },
      INDEX_TIMEOUT_MS,
    );
  }

  /**
   * Detect changed symbols from a git diff.
   */
  async detectChanges(
    tenantId: string,
    repoId: string,
    diff: string,
  ): Promise<DetectChangesResult | null> {
    return this._post<DetectChangesResult>(
      `/repos/${tenantId}/${repoId}/detect-changes`,
      { diff },
    );
  }

  /**
   * Get blast radius / impact analysis for a symbol.
   */
  async getImpact(
    tenantId: string,
    repoId: string,
    symbol: string,
    depth: number = 3,
  ): Promise<ImpactResult | null> {
    return this._post<ImpactResult>(
      `/repos/${tenantId}/${repoId}/impact`,
      { symbol, depth },
    );
  }

  /**
   * Get 360-degree context for a symbol.
   */
  async getContext(
    tenantId: string,
    repoId: string,
    symbol: string,
  ): Promise<SymbolContext | null> {
    return this._post<SymbolContext>(
      `/repos/${tenantId}/${repoId}/context`,
      { symbol },
    );
  }

  /**
   * Get dead code symbols in the repo.
   */
  async getDeadCode(
    tenantId: string,
    repoId: string,
  ): Promise<DeadCodeResult | null> {
    return this._post<DeadCodeResult>(
      `/repos/${tenantId}/${repoId}/dead-code`,
      {},
    );
  }

  /**
   * Check index status of a repository.
   */
  async getStatus(
    tenantId: string,
    repoId: string,
  ): Promise<RepoStatus | null> {
    return this._get<RepoStatus>(`/repos/${tenantId}/${repoId}/status`);
  }

  /**
   * Check if the sidecar is healthy.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const result = await this._get<{ status: string }>("/health");
      return result?.status === "ok";
    } catch {
      return false;
    }
  }

  // ── Internal ──

  private async _post<T>(
    path: string,
    body: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;
    const timeout = timeoutMs ?? this.timeoutMs;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        this.logger.warn(
          { url, status: response.status, body: errorText.slice(0, 200) },
          "Axon sidecar request failed",
        );
        return null;
      }

      return (await response.json()) as T;
    } catch (err) {
      this.logger.warn({ err, url }, "Axon sidecar request error");
      return null;
    }
  }

  private async _get<T>(path: string): Promise<T | null> {
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(url, { signal: controller.signal });

      clearTimeout(timer);

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as T;
    } catch (err) {
      this.logger.warn({ err, url }, "Axon sidecar GET error");
      return null;
    }
  }
}
