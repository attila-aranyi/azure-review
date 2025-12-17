export type DiffHunk = {
  filePath: string;
  startLine: number;
  endLine: number;
  hunkText: string;
  localContext: string;
};

