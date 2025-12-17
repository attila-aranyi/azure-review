export type IdempotencyKey = {
  repoId: string;
  prId: number;
  iteration?: number;
  findingHash: string;
};

export interface IdempotencyStore {
  has(key: IdempotencyKey): Promise<boolean>;
  put(key: IdempotencyKey): Promise<void>;
}

export function createInMemoryIdempotencyStore(): IdempotencyStore {
  const seen = new Set<string>();
  const toKey = (key: IdempotencyKey) =>
    `${key.repoId}:${key.prId}:${key.iteration ?? "na"}:${key.findingHash}`;

  return {
    async has(key) {
      return seen.has(toKey(key));
    },
    async put(key) {
      seen.add(toKey(key));
    }
  };
}

