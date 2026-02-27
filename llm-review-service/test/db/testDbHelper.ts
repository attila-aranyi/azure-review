import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "../../src/db/schema";
import type { DrizzleInstance } from "../../src/db/connection";

const TEST_DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://localhost:5432/llm_review_test";

let pool: pg.Pool | null = null;
let db: DrizzleInstance | null = null;

export function getTestDatabaseUrl(): string {
  return TEST_DATABASE_URL;
}

export function isDbAvailable(): boolean {
  return !!process.env.DATABASE_URL;
}

export async function getTestDb(): Promise<DrizzleInstance> {
  if (!db) {
    pool = new pg.Pool({
      connectionString: TEST_DATABASE_URL,
      max: 5,
    });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function setupTestDb(): Promise<DrizzleInstance> {
  const testDb = await getTestDb();

  // Create tables if they don't exist
  await testDb.execute(sql`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ado_org_id VARCHAR(255) NOT NULL,
      ado_org_name VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      plan VARCHAR(50) NOT NULL DEFAULT 'free',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await testDb.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS tenants_ado_org_id_unique ON tenants (ado_org_id)
  `);

  await testDb.execute(sql`
    CREATE TABLE IF NOT EXISTS tenant_oauth_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await testDb.execute(sql`
    CREATE INDEX IF NOT EXISTS tenant_oauth_tokens_tenant_id_idx ON tenant_oauth_tokens (tenant_id)
  `);

  await testDb.execute(sql`
    CREATE TABLE IF NOT EXISTS tenant_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      llm_mode VARCHAR(50) NOT NULL DEFAULT 'managed',
      llm_provider VARCHAR(100),
      llm_api_key_enc TEXT,
      llm_endpoint TEXT,
      llm_model_review VARCHAR(100) NOT NULL DEFAULT 'gpt-4o',
      llm_model_a11y VARCHAR(100) NOT NULL DEFAULT 'gpt-4o',
      review_strictness VARCHAR(50) NOT NULL DEFAULT 'balanced',
      max_files INTEGER NOT NULL DEFAULT 20,
      max_diff_size INTEGER NOT NULL DEFAULT 2000,
      file_include_glob TEXT,
      file_exclude_glob TEXT,
      enable_a11y_text BOOLEAN NOT NULL DEFAULT TRUE,
      enable_a11y_visual BOOLEAN NOT NULL DEFAULT FALSE,
      enable_security BOOLEAN NOT NULL DEFAULT TRUE,
      comment_style VARCHAR(50) NOT NULL DEFAULT 'inline',
      min_severity VARCHAR(50) NOT NULL DEFAULT 'low',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await testDb.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS tenant_configs_tenant_id_unique ON tenant_configs (tenant_id)
  `);

  await testDb.execute(sql`
    CREATE TABLE IF NOT EXISTS project_enrollments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ado_project_id VARCHAR(255) NOT NULL,
      ado_project_name VARCHAR(255),
      webhook_secret_enc TEXT,
      service_hook_ids JSONB DEFAULT '[]',
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await testDb.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS project_enrollments_tenant_project_unique ON project_enrollments (tenant_id, ado_project_id)
  `);

  await testDb.execute(sql`
    CREATE INDEX IF NOT EXISTS project_enrollments_tenant_id_idx ON project_enrollments (tenant_id)
  `);

  await testDb.execute(sql`
    CREATE TABLE IF NOT EXISTS reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ado_project_id VARCHAR(255),
      repo_id VARCHAR(255) NOT NULL,
      pr_id INTEGER NOT NULL,
      idempotency_key VARCHAR(255),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      source_commit VARCHAR(64),
      target_commit VARCHAR(64),
      changed_files JSONB DEFAULT '[]',
      hunks_processed INTEGER DEFAULT 0,
      token_usage JSONB DEFAULT '{}',
      timings JSONB DEFAULT '{}',
      error TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await testDb.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS reviews_idempotency_key_unique ON reviews (idempotency_key)
  `);

  await testDb.execute(sql`
    CREATE INDEX IF NOT EXISTS reviews_tenant_id_idx ON reviews (tenant_id)
  `);

  await testDb.execute(sql`
    CREATE INDEX IF NOT EXISTS reviews_repo_pr_idx ON reviews (repo_id, pr_id)
  `);

  await testDb.execute(sql`
    CREATE TABLE IF NOT EXISTS review_findings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
      issue_type VARCHAR(50) NOT NULL,
      severity VARCHAR(50) NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      message TEXT NOT NULL,
      suggestion TEXT,
      finding_hash VARCHAR(64) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'posted',
      ado_thread_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await testDb.execute(sql`
    CREATE INDEX IF NOT EXISTS review_findings_review_id_idx ON review_findings (review_id)
  `);

  return testDb;
}

export async function truncateAll(testDb: DrizzleInstance): Promise<void> {
  await testDb.execute(sql`TRUNCATE review_findings, reviews, project_enrollments, tenant_configs, tenant_oauth_tokens, tenants CASCADE`);
}

export async function teardownTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}
