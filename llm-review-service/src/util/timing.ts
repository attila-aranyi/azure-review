export async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<{ label: string; ms: number; result: T }> {
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  return { label, ms, result };
}

