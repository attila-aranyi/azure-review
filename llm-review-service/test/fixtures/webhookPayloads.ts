export const validNestedPayload = {
  resource: {
    pullRequestId: 42,
    repository: {
      id: "repo-abc-123"
    }
  }
};

export const validFlatPayload = {
  pullRequestId: 42,
  repository: {
    id: "repo-abc-123"
  }
};

export const missingPrIdPayload = {
  repository: {
    id: "repo-abc-123"
  }
};

export const missingRepoIdPayload = {
  pullRequestId: 42
};

export const invalidPayload = {
  resource: {
    pullRequestId: -1,
    repository: {
      id: ""
    }
  }
};
