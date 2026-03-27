import { eq, and, isNull, sql } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { reviewRules } from "../schema";
import { MAX_RULES_PER_SCOPE } from "../../review/reviewRules";

export type RuleRow = typeof reviewRules.$inferSelect;
export type NewRule = typeof reviewRules.$inferInsert;

export interface RulesRepo {
  /** List tenant-level rules (adoRepoId IS NULL) */
  listTenantRules(tenantId: string): Promise<RuleRow[]>;

  /** List repo-level rules */
  listRepoRules(tenantId: string, repoId: string): Promise<RuleRow[]>;

  /** List effective rules for a repo: tenant-level + repo-level */
  listEffectiveRules(tenantId: string, repoId: string): Promise<RuleRow[]>;

  /** Get a single rule by ID (scoped to tenant) */
  findById(tenantId: string, ruleId: string): Promise<RuleRow | null>;

  /** Create a new rule. Throws if scope cap (25) is reached. */
  create(data: NewRule): Promise<RuleRow>;

  /** Update a rule by ID */
  update(tenantId: string, ruleId: string, data: Partial<Omit<NewRule, "id" | "tenantId" | "createdAt">>): Promise<RuleRow | null>;

  /** Delete a rule by ID */
  remove(tenantId: string, ruleId: string): Promise<boolean>;

  /** Count rules in a scope */
  countInScope(tenantId: string, repoId: string | null): Promise<number>;
}

export function createRulesRepo(db: DrizzleInstance): RulesRepo {
  return {
    async listTenantRules(tenantId) {
      return db
        .select()
        .from(reviewRules)
        .where(and(eq(reviewRules.tenantId, tenantId), isNull(reviewRules.adoRepoId)))
        .orderBy(reviewRules.name);
    },

    async listRepoRules(tenantId, repoId) {
      return db
        .select()
        .from(reviewRules)
        .where(and(eq(reviewRules.tenantId, tenantId), eq(reviewRules.adoRepoId, repoId)))
        .orderBy(reviewRules.name);
    },

    async listEffectiveRules(tenantId, repoId) {
      // Tenant-level rules + repo-level rules
      return db
        .select()
        .from(reviewRules)
        .where(
          and(
            eq(reviewRules.tenantId, tenantId),
            sql`(${reviewRules.adoRepoId} IS NULL OR ${reviewRules.adoRepoId} = ${repoId})`
          )
        )
        .orderBy(reviewRules.name);
    },

    async findById(tenantId, ruleId) {
      const result = await db
        .select()
        .from(reviewRules)
        .where(and(eq(reviewRules.tenantId, tenantId), eq(reviewRules.id, ruleId)))
        .limit(1);
      return result[0] ?? null;
    },

    async create(data) {
      // Check scope cap
      const count = await this.countInScope(data.tenantId, data.adoRepoId ?? null);
      if (count >= MAX_RULES_PER_SCOPE) {
        throw new Error(`Maximum of ${MAX_RULES_PER_SCOPE} rules per scope reached`);
      }

      const result = await db
        .insert(reviewRules)
        .values(data)
        .returning();
      return result[0];
    },

    async update(tenantId, ruleId, data) {
      const result = await db
        .update(reviewRules)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(reviewRules.tenantId, tenantId), eq(reviewRules.id, ruleId)))
        .returning();
      return result[0] ?? null;
    },

    async remove(tenantId, ruleId) {
      const result = await db
        .delete(reviewRules)
        .where(and(eq(reviewRules.tenantId, tenantId), eq(reviewRules.id, ruleId)))
        .returning();
      return result.length > 0;
    },

    async countInScope(tenantId, repoId) {
      const condition = repoId
        ? and(eq(reviewRules.tenantId, tenantId), eq(reviewRules.adoRepoId, repoId))
        : and(eq(reviewRules.tenantId, tenantId), isNull(reviewRules.adoRepoId));

      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(reviewRules)
        .where(condition);
      return result[0]?.count ?? 0;
    },
  };
}
