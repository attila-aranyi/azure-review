import { eq } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { tenantConfigs } from "../schema";

export type TenantConfigRow = typeof tenantConfigs.$inferSelect;
export type NewTenantConfig = typeof tenantConfigs.$inferInsert;
export type TenantConfigData = Omit<NewTenantConfig, "id" | "tenantId" | "createdAt" | "updatedAt">;

export interface ConfigRepo {
  findByTenantId(tenantId: string): Promise<TenantConfigRow | null>;
  upsert(tenantId: string, data: Partial<TenantConfigData>): Promise<TenantConfigRow>;
}

export function createConfigRepo(db: DrizzleInstance): ConfigRepo {
  return {
    async findByTenantId(tenantId) {
      const result = await db.select().from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).limit(1);
      return result[0] ?? null;
    },

    async upsert(tenantId, data) {
      const result = await db
        .insert(tenantConfigs)
        .values({ tenantId, ...data })
        .onConflictDoUpdate({
          target: tenantConfigs.tenantId,
          set: { ...data, updatedAt: new Date() },
        })
        .returning();
      return result[0];
    },
  };
}
