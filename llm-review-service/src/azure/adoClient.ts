import { Buffer } from "node:buffer";
import { request } from "undici";
import type { Dispatcher } from "undici";
import type { Config } from "../config";
import type { AdoCreateThreadRequest, AdoListPullRequestChangesResponse, AdoPullRequest } from "./adoTypes";

export type AdoVersionDescriptor = {
  version: string;
  versionType: "commit" | "branch";
  versionOptions?: "none" | "previousChange" | "firstParent";
};

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

  constructor(private readonly config: Config) {
    this.baseUrl = `https://dev.azure.com/${this.config.ADO_ORG}/${this.config.ADO_PROJECT}/_apis/git`;
    this.authHeader = `Basic ${Buffer.from(`:${this.config.ADO_PAT}`).toString("base64")}`;
  }

  private async requestJson<T>(
    method: Dispatcher.HttpMethod,
    url: string,
    body?: unknown
  ): Promise<T> {
    const res = await request(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await res.body.text();
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

  async getPullRequest(_repoId: string, _prId: number): Promise<AdoPullRequest> {
    const url = this.buildUrl(`/repositories/${_repoId}/pullRequests/${_prId}`);
    return this.requestJson<AdoPullRequest>("GET", url);
  }

  async listPullRequestChanges(_repoId: string, _prId: number): Promise<string[]> {
    const url = this.buildUrl(`/repositories/${_repoId}/pullRequests/${_prId}/changes`);
    const json = await this.requestJson<AdoListPullRequestChangesResponse>("GET", url);
    const paths = (json.changes ?? [])
      .map((c) => c.item?.path)
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    return Array.from(new Set(paths));
  }

  async getItemContent(
    _repoId: string,
    _path: string,
    _versionDescriptor: AdoVersionDescriptor
  ): Promise<string> {
    const query: Record<string, string> = {
      path: _path,
      download: "true",
      "versionDescriptor.version": _versionDescriptor.version,
      "versionDescriptor.versionType": _versionDescriptor.versionType
    };
    if (_versionDescriptor.versionOptions) {
      query["versionDescriptor.versionOptions"] = _versionDescriptor.versionOptions;
    }

    const url = this.buildUrl(`/repositories/${_repoId}/items`, query);
    return this.requestText("GET", url);
  }

  async createPullRequestThread(_repoId: string, _prId: number, _thread: AdoCreateThreadRequest): Promise<void> {
    const url = this.buildUrl(`/repositories/${_repoId}/pullRequests/${_prId}/threads`);
    await this.requestJson("POST", url, _thread);
  }
}
