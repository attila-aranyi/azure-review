export type AdoCommitRef = {
  commitId: string;
};

export type AdoPullRequest = {
  pullRequestId: number;
  sourceRefName?: string;
  targetRefName?: string;
  lastMergeSourceCommit?: AdoCommitRef;
  lastMergeTargetCommit?: AdoCommitRef;
  lastMergeCommit?: AdoCommitRef;
};

export type AdoPullRequestChange = {
  changeType?: string;
  item?: {
    path?: string;
    gitObjectType?: string;
  };
};

export type AdoListPullRequestChangesResponse = {
  changes?: AdoPullRequestChange[];
};

export type AdoThreadContext = {
  filePath: string;
  rightFileStart: { line: number; offset: number };
  rightFileEnd: { line: number; offset: number };
};

export type AdoThreadComment = {
  parentCommentId?: number;
  content: string;
  commentType: number;
};

export type AdoCreateThreadRequest = {
  comments: AdoThreadComment[];
  status: number;
  threadContext: AdoThreadContext;
};
