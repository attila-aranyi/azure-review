import { eq } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { tenants } from "../schema";

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export interface TenantRepo {
  findById(id: string): Promise<Tenant | null>;
  findByAdoOrgId(orgId: string): Promise<Tenant | null>;
  create(data: NewTenant): Promise<Tenant>;
  updateStatus(id: string, status: string): Promise<void>;
  upsert(data: NewTenant): Promise<Tenant>;
}

export function createTenantRepo(db: DrizzleInstance): TenantRepo {
  return {
    async findById(id) {
      const result = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
      return result[0] ?? null;
    },

    async findByAdoOrgId(orgId) {
      const result = await db.select().from(tenants).where(eq(tenants.adoOrgId, orgId)).limit(1);
      return result[0] ?? null;
    },

    async create(data) {
      const result = await db.insert(tenants).values(data).returning();
      return result[0];
    },

    async updateStatus(id, status) {
      await db.update(tenants).set({ status, updatedAt: new Date() }).where(eq(tenants.id, id));
    },

    async upsert(data) {
      const result = await db
        .insert(tenants)
        .values(data)
        .onConflictDoUpdate({
          target: tenants.adoOrgId,
          set: {
            adoOrgName: data.adoOrgName,
            status: data.status ?? "active",
            plan: data.plan ?? "free",
            updatedAt: new Date(),
          },
        })
        .returning();
      return result[0];
    },
  };
}
