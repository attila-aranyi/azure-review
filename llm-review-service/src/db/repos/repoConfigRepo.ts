import { eq, and } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { repoConfigs } from "../schema";

export type RepoConfigRow = typeof repoConfigs.$inferSelect;
export type NewRepoConfig = typeof repoConfigs.$inferInsert;
export type RepoConfigData = Omit<NewRepoConfig, "id" | "tenantId" | "adoRepoId" | "createdAt" | "updatedAt">;

export interface RepoConfigRepo {
  findByTenantAndRepo(tenantId: string, repoId: string): Promise<RepoConfigRow | null>;
  findByTenantId(tenantId: string): Promise<RepoConfigRow[]>;
  upsert(tenantId: string, repoId: string, data: Partial<RepoConfigData>): Promise<RepoConfigRow>;
  remove(tenantId: string, repoId: string): Promise<boolean>;
}

export function createRepoConfigRepo(db: DrizzleInstance): RepoConfigRepo {
  return {
    async findByTenantAndRepo(tenantId, repoId) {
      const result = await db
        .select()
        .from(repoConfigs)
        .where(and(eq(repoConfigs.tenantId, tenantId), eq(repoConfigs.adoRepoId, repoId)))
        .limit(1);
      return result[0] ?? null;
    },

    async findByTenantId(tenantId) {
      return db.select().from(repoConfigs).where(eq(repoConfigs.tenantId, tenantId));
    },

    async upsert(tenantId, repoId, data) {
      const result = await db
        .insert(repoConfigs)
        .values({ tenantId, adoRepoId: repoId, ...data })
        .onConflictDoUpdate({
          target: [repoConfigs.tenantId, repoConfigs.adoRepoId],
          set: { ...data, updatedAt: new Date() },
        })
        .returning();
      return result[0];
    },

    async remove(tenantId, repoId) {
      const result = await db
        .delete(repoConfigs)
        .where(and(eq(repoConfigs.tenantId, tenantId), eq(repoConfigs.adoRepoId, repoId)))
        .returning();
      return result.length > 0;
    },
  };
}
