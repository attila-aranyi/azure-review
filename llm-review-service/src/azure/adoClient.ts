import type { Config } from "../config";
import type { AdoPullRequest, AdoThread } from "./adoTypes";

export class AdoClient {
  constructor(private readonly config: Config) {}

  async getPullRequest(_repoId: string, _prId: number): Promise<AdoPullRequest> {
    throw new Error("Not implemented");
  }

  async listPullRequestChanges(_repoId: string, _prId: number): Promise<string[]> {
    throw new Error("Not implemented");
  }

  async getItemContent(
    _repoId: string,
    _path: string,
    _versionDescriptor: Record<string, string>
  ): Promise<string> {
    throw new Error("Not implemented");
  }

  async createPullRequestThread(_repoId: string, _prId: number, _thread: AdoThread): Promise<void> {
    throw new Error("Not implemented");
  }
}

