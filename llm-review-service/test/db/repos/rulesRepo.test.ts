import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { DrizzleInstance } from "../../../src/db/connection";
import { createRulesRepo } from "../../../src/db/repos/rulesRepo";
import { createTenantRepo } from "../../../src/db/repos/tenantRepo";
import { setupTestDb, truncateAll, teardownTestDb, isDbAvailable } from "../testDbHelper";
import { MAX_RULES_PER_SCOPE } from "../../../src/review/reviewRules";

describe.skipIf(!isDbAvailable())("rulesRepo (integration)", () => {
  let db: DrizzleInstance;
  let tenantId: string;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    await truncateAll(db);
    const tenantRepo = createTenantRepo(db);
    const tenant = await tenantRepo.create({ adoOrgId: "rules-test-org" });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  const makeRuleData = (overrides: Record<string, unknown> = {}) => ({
    tenantId,
    name: "no-any-type",
    description: "Disallow any type in TypeScript",
    category: "style",
    severity: "medium",
    instruction: "Flag any use of the any type",
    ...overrides,
  });

  describe("create()", () => {
    it("creates a tenant-level rule", async () => {
      const repo = createRulesRepo(db);
      const rule = await repo.create(makeRuleData());

      expect(rule.id).toBeDefined();
      expect(rule.tenantId).toBe(tenantId);
      expect(rule.adoRepoId).toBeNull();
      expect(rule.name).toBe("no-any-type");
      expect(rule.category).toBe("style");
      expect(rule.severity).toBe("medium");
      expect(rule.enabled).toBe(true);
      expect(rule.createdAt).toBeInstanceOf(Date);
    });

    it("creates a repo-level rule", async () => {
      const repo = createRulesRepo(db);
      const rule = await repo.create(makeRuleData({ adoRepoId: "repo-1" }));

      expect(rule.adoRepoId).toBe("repo-1");
    });

    it("creates rule with optional fields", async () => {
      const repo = createRulesRepo(db);
      const rule = await repo.create(makeRuleData({
        fileGlob: "*.ts",
        exampleGood: "const x: string = 'hello'",
        exampleBad: "const x: any = 'hello'",
      }));

      expect(rule.fileGlob).toBe("*.ts");
      expect(rule.exampleGood).toBe("const x: string = 'hello'");
      expect(rule.exampleBad).toBe("const x: any = 'hello'");
    });

    it("enforces 25 rules per scope cap for tenant-level", async () => {
      const repo = createRulesRepo(db);
      for (let i = 0; i < MAX_RULES_PER_SCOPE; i++) {
        await repo.create(makeRuleData({ name: `rule-${String(i).padStart(2, "0")}` }));
      }

      await expect(
        repo.create(makeRuleData({ name: "rule-overflow" }))
      ).rejects.toThrow(/Maximum of 25 rules/);
    });

    it("enforces 25 rules per scope cap for repo-level independently", async () => {
      const repo = createRulesRepo(db);
      // Fill tenant scope
      for (let i = 0; i < MAX_RULES_PER_SCOPE; i++) {
        await repo.create(makeRuleData({ name: `tenant-rule-${String(i).padStart(2, "0")}` }));
      }

      // Repo scope should still have room
      const repoRule = await repo.create(makeRuleData({ name: "repo-rule-00", adoRepoId: "repo-1" }));
      expect(repoRule.adoRepoId).toBe("repo-1");
    });

    it("enforces unique name per scope", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData());

      await expect(
        repo.create(makeRuleData())
      ).rejects.toThrow();
    });

    it("allows same name in different repo scopes", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData({ adoRepoId: "repo-1" }));
      const rule2 = await repo.create(makeRuleData({ adoRepoId: "repo-2" }));
      expect(rule2.adoRepoId).toBe("repo-2");
    });
  });

  describe("listTenantRules()", () => {
    it("returns only tenant-level rules", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData({ name: "tenant-rule" }));
      await repo.create(makeRuleData({ name: "repo-rule", adoRepoId: "repo-1" }));

      const rules = await repo.listTenantRules(tenantId);
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe("tenant-rule");
    });

    it("returns empty array when no tenant rules exist", async () => {
      const repo = createRulesRepo(db);
      const rules = await repo.listTenantRules(tenantId);
      expect(rules).toEqual([]);
    });

    it("returns rules ordered by name", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData({ name: "z-rule" }));
      await repo.create(makeRuleData({ name: "a-rule" }));

      const rules = await repo.listTenantRules(tenantId);
      expect(rules[0].name).toBe("a-rule");
      expect(rules[1].name).toBe("z-rule");
    });
  });

  describe("listRepoRules()", () => {
    it("returns only repo-level rules for specified repo", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData({ name: "tenant-rule" }));
      await repo.create(makeRuleData({ name: "repo1-rule", adoRepoId: "repo-1" }));
      await repo.create(makeRuleData({ name: "repo2-rule", adoRepoId: "repo-2" }));

      const rules = await repo.listRepoRules(tenantId, "repo-1");
      expect(rules).toHaveLength(1);
      expect(rules[0].name).toBe("repo1-rule");
    });
  });

  describe("listEffectiveRules()", () => {
    it("returns tenant-level + repo-level rules combined", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData({ name: "tenant-rule" }));
      await repo.create(makeRuleData({ name: "repo-rule", adoRepoId: "repo-1" }));
      await repo.create(makeRuleData({ name: "other-repo-rule", adoRepoId: "repo-2" }));

      const rules = await repo.listEffectiveRules(tenantId, "repo-1");
      expect(rules).toHaveLength(2);
      const names = rules.map((r) => r.name);
      expect(names).toContain("tenant-rule");
      expect(names).toContain("repo-rule");
      expect(names).not.toContain("other-repo-rule");
    });
  });

  describe("findById()", () => {
    it("returns null for non-existent rule", async () => {
      const repo = createRulesRepo(db);
      const result = await repo.findById(tenantId, "00000000-0000-0000-0000-000000000000");
      expect(result).toBeNull();
    });

    it("returns the rule when found", async () => {
      const repo = createRulesRepo(db);
      const created = await repo.create(makeRuleData());
      const found = await repo.findById(tenantId, created.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("no-any-type");
    });

    it("does not return rules from other tenants", async () => {
      const repo = createRulesRepo(db);
      const created = await repo.create(makeRuleData());

      const tenantRepo = createTenantRepo(db);
      const tenant2 = await tenantRepo.create({ adoOrgId: "other-org" });

      const found = await repo.findById(tenant2.id, created.id);
      expect(found).toBeNull();
    });
  });

  describe("update()", () => {
    it("updates rule fields", async () => {
      const repo = createRulesRepo(db);
      const created = await repo.create(makeRuleData());

      const updated = await repo.update(tenantId, created.id, {
        description: "Updated description",
        severity: "high",
        enabled: false,
      });

      expect(updated).not.toBeNull();
      expect(updated!.description).toBe("Updated description");
      expect(updated!.severity).toBe("high");
      expect(updated!.enabled).toBe(false);
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    it("returns null for non-existent rule", async () => {
      const repo = createRulesRepo(db);
      const result = await repo.update(tenantId, "00000000-0000-0000-0000-000000000000", {
        description: "Updated",
      });
      expect(result).toBeNull();
    });
  });

  describe("remove()", () => {
    it("deletes an existing rule", async () => {
      const repo = createRulesRepo(db);
      const created = await repo.create(makeRuleData());

      const removed = await repo.remove(tenantId, created.id);
      expect(removed).toBe(true);

      const found = await repo.findById(tenantId, created.id);
      expect(found).toBeNull();
    });

    it("returns false for non-existent rule", async () => {
      const repo = createRulesRepo(db);
      const removed = await repo.remove(tenantId, "00000000-0000-0000-0000-000000000000");
      expect(removed).toBe(false);
    });
  });

  describe("countInScope()", () => {
    it("counts tenant-level rules", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData({ name: "rule-01" }));
      await repo.create(makeRuleData({ name: "rule-02" }));

      const count = await repo.countInScope(tenantId, null);
      expect(count).toBe(2);
    });

    it("counts repo-level rules separately", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData({ name: "tenant-rule" }));
      await repo.create(makeRuleData({ name: "repo-rule-01", adoRepoId: "repo-1" }));
      await repo.create(makeRuleData({ name: "repo-rule-02", adoRepoId: "repo-1" }));

      expect(await repo.countInScope(tenantId, null)).toBe(1);
      expect(await repo.countInScope(tenantId, "repo-1")).toBe(2);
    });
  });

  describe("tenant isolation", () => {
    it("rules from one tenant are not visible to another", async () => {
      const repo = createRulesRepo(db);
      await repo.create(makeRuleData());

      const tenantRepo = createTenantRepo(db);
      const tenant2 = await tenantRepo.create({ adoOrgId: "isolated-org" });

      const rules = await repo.listTenantRules(tenant2.id);
      expect(rules).toEqual([]);
    });
  });
});
