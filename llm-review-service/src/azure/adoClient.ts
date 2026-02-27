import { Buffer } from "node:buffer";
import { request } from "undici";
import type { Dispatcher } from "undici";
import type { Logger } from "pino";
import type { Config } from "../config";
import type { AdoCreateThreadRequest, AdoCreateThreadResponse, AdoCreatePullRequestStatusRequest, AdoUpdateCommentRequest, AdoIterationsResponse, AdoListPullRequestChangesResponse, AdoPullRequest } from "./adoTypes";

export type AdoVersionDescriptor = {
  version: string;
  versionType: "commit" | "branch";
  versionOptions?: "none" | "previousChange" | "firstParent";
};

export type AdoAuth =
  | { type: "oauth"; accessToken: string }
  | { type: "pat"; token: string };

const ADO_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildAuthHeader(auth: AdoAuth): string {
  if (auth.type === "oauth") {
    return `Bearer ${auth.accessToken}`;
  }
  return `Basic ${Buffer.from(`:${auth.token}`).toString("base64")}`;
}

function isAdoAuth(value: unknown): value is AdoAuth {
  return typeof value === "object" && value !== null && "type" in value &&
    ((value as AdoAuth).type === "oauth" || (value as AdoAuth).type === "pat");
}

export class AdoClientError extends Error {
  readonly name = "AdoClientError";
  constructor(
    message: string,
    readonly details: { statusCode?: number; url?: string; cause?: unknown }
  ) {
    super(message);
  }
}

export class AdoClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly writeAuthHeader: string;
  private readonly logger?: Logger;

  constructor(config: Config, logger?: Logger);
  constructor(auth: AdoAuth, orgUrl: string, project?: string, logger?: Logger);
  constructor(
    configOrAuth: Config | AdoAuth,
    loggerOrOrgUrl?: Logger | string,
    project?: string,
    loggerArg?: Logger,
  ) {
    if (isAdoAuth(configOrAuth)) {
      // New multi-tenant constructor: AdoAuth + orgUrl + optional project
      const auth = configOrAuth;
      const orgUrl = loggerOrOrgUrl as string;
      const proj = project;
      this.logger = loggerArg;
      this.baseUrl = proj
        ? `${orgUrl}/${proj}/_apis/git`
        : `${orgUrl}/_apis/git`;
      this.authHeader = buildAuthHeader(auth);
      this.writeAuthHeader = this.authHeader;
    } else {
      // Legacy constructor: Config + optional Logger
      const config = configOrAuth as Config;
      this.logger = loggerOrOrgUrl as Logger | undefined;
      this.baseUrl = `https://dev.azure.com/${config.ADO_ORG}/${config.ADO_PROJECT}/_apis/git`;
      this.authHeader = `Basic ${Buffer.from(`:${config.ADO_PAT}`).toString("base64")}`;
      this.writeAuthHeader = config.ADO_BOT_PAT
        ? `Basic ${Buffer.from(`:${config.ADO_BOT_PAT}`).toString("base64")}`
        : this.authHeader;
    }
  }

  private assertValidRepoId(repoId: string): void {
    if (!ADO_GUID_RE.test(repoId)) {
      throw new AdoClientError("Invalid repository ID format", { url: repoId });
    }
  }

  private async requestJson<T>(
    method: Dispatcher.HttpMethod,
    url: string,
    body?: unknown,
    authOverride?: string
  ): Promise<T> {
    const res = await request(url, {
      method,
      headers: {
        Authorization: authOverride ?? this.authHeader,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.body.text();
    this.logger?.debug({ method, statusCode: res.statusCode }, "ADO API response");
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new AdoClientError(`Azure DevOps API request failed: ${res.statusCode}`, {
        statusCode: res.statusCode,
        url,
        cause: text
      });
    }

    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new AdoClientError("Azure DevOps API returned invalid JSON", { statusCode: res.statusCode, url, cause: err });
    }
  }

  private async requestText(method: Dispatcher.HttpMethod, url: string): Promise<string> {
    const res = await request(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "text/plain"
      }
    });
    const text = await res.body.text();
    this.logger?.debug({ method, statusCode: res.statusCode }, "ADO API response");
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new AdoClientError(`Azure DevOps API request failed: ${res.statusCode}`, {
        statusCode: res.statusCode,
        url,
        cause: text
      });
    }
    return text;
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("api-version", "7.1-preview.1");
    for (const [key, value] of Object.entries(query ?? {})) {
      if (typeof value === "string" && value.length > 0) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async getPullRequest(repoId: string, prId: number): Promise<AdoPullRequest> {
    this.assertValidRepoId(repoId);
    const url = this.buildUrl(`/repositories/${repoId}/pullRequests/${prId}`);
    return this.requestJson<AdoPullRequest>("GET", url);
  }

  async listPullRequestChanges(repoId: string, prId: number): Promise<string[]> {
    this.assertValidRepoId(repoId);
    const itersUrl = this.buildUrl(`/repositories/${repoId}/pullRequests/${prId}/iterations`);
    const iters = await this.requestJson<AdoIterationsResponse>("GET", itersUrl);

    const iterations = iters.value ?? [];
    if (iterations.length === 0) {
      throw new AdoClientError("No iterations found for pull request", { url: itersUrl });
    }
    const lastId = iterations.at(-1)!.id;
    if (!Number.isInteger(lastId) || lastId < 1) {
      throw new AdoClientError("Invalid iteration ID", { url: itersUrl });
    }

    const url = this.buildUrl(`/repositories/${repoId}/pullRequests/${prId}/iterations/${lastId}/changes`);
    const json = await this.requestJson<AdoListPullRequestChangesResponse>("GET", url);
    const paths = (json.changeEntries ?? [])
      // originalPath is the pre-rename path used as fallback for file moves/renames
      .map((c) => c.item?.path ?? c.originalPath)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    return Array.from(new Set(paths));
  }

  async getItemContent(
    repoId: string,
    filePath: string,
    versionDescriptor: AdoVersionDescriptor
  ): Promise<string> {
    this.assertValidRepoId(repoId);
    const query: Record<string, string> = {
      path: filePath,
      download: "true",
      "versionDescriptor.version": versionDescriptor.version,
      "versionDescriptor.versionType": versionDescriptor.versionType
    };
    if (versionDescriptor.versionOptions) {
      query["versionDescriptor.versionOptions"] = versionDescriptor.versionOptions;
    }

    const url = this.buildUrl(`/repositories/${repoId}/items`, query);
    return this.requestText("GET", url);
  }

  async createPullRequestThread(repoId: string, prId: number, thread: AdoCreateThreadRequest): Promise<AdoCreateThreadResponse> {
    this.assertValidRepoId(repoId);
    const url = this.buildUrl(`/repositories/${repoId}/pullRequests/${prId}/threads`);
    return this.requestJson<AdoCreateThreadResponse>("POST", url, thread, this.writeAuthHeader);
  }

  async createPullRequestStatus(repoId: string, prId: number, status: AdoCreatePullRequestStatusRequest): Promise<void> {
    this.assertValidRepoId(repoId);
    const url = this.buildUrl(`/repositories/${repoId}/pullRequests/${prId}/statuses`);
    await this.requestJson("POST", url, status, this.writeAuthHeader);
  }

  async updateThreadComment(repoId: string, prId: number, threadId: number, commentId: number, update: AdoUpdateCommentRequest): Promise<void> {
    this.assertValidRepoId(repoId);
    const url = this.buildUrl(`/repositories/${repoId}/pullRequests/${prId}/threads/${threadId}/comments/${commentId}`);
    await this.requestJson("PATCH", url, update, this.writeAuthHeader);
  }
}
