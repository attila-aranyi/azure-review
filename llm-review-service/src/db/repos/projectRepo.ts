import { eq, and } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { projectEnrollments } from "../schema";

export type ProjectEnrollment = typeof projectEnrollments.$inferSelect;
export type NewProjectEnrollment = typeof projectEnrollments.$inferInsert;

// HIGH-8: Restrict update fields to prevent mass assignment
export type ProjectUpdateData = Partial<
  Pick<NewProjectEnrollment, "status" | "webhookSecretEnc" | "serviceHookIds" | "adoProjectName">
>;

export interface ProjectRepo {
  findByTenantId(tenantId: string): Promise<ProjectEnrollment[]>;
  findByTenantAndProject(tenantId: string, projectId: string): Promise<ProjectEnrollment | null>;
  create(data: NewProjectEnrollment): Promise<ProjectEnrollment>;
  update(tenantId: string, projectId: string, data: ProjectUpdateData): Promise<void>;
  deactivate(tenantId: string, projectId: string): Promise<void>;
}

export function createProjectRepo(db: DrizzleInstance): ProjectRepo {
  return {
    async findByTenantId(tenantId) {
      return db.select().from(projectEnrollments).where(eq(projectEnrollments.tenantId, tenantId));
    },

    async findByTenantAndProject(tenantId, projectId) {
      const result = await db
        .select()
        .from(projectEnrollments)
        .where(and(eq(projectEnrollments.tenantId, tenantId), eq(projectEnrollments.adoProjectId, projectId)))
        .limit(1);
      return result[0] ?? null;
    },

    async create(data) {
      const result = await db.insert(projectEnrollments).values(data).returning();
      return result[0];
    },

    async update(tenantId, projectId, data) {
      await db
        .update(projectEnrollments)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(projectEnrollments.tenantId, tenantId), eq(projectEnrollments.adoProjectId, projectId)));
    },

    async deactivate(tenantId, projectId) {
      await db
        .update(projectEnrollments)
        .set({ status: "inactive", updatedAt: new Date() })
        .where(and(eq(projectEnrollments.tenantId, tenantId), eq(projectEnrollments.adoProjectId, projectId)));
    },
  };
}
