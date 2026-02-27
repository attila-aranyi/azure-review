import { eq, and, sql, desc } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { reviews, reviewFindings } from "../schema";

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type ReviewFinding = typeof reviewFindings.$inferSelect;
export type NewReviewFinding = typeof reviewFindings.$inferInsert;

export type ReviewCompletion = {
  status: string;
  hunksProcessed?: number;
  tokenUsage?: Record<string, number>;
  timings?: Record<string, number>;
  error?: string;
  completedAt?: Date;
};

export type PaginationOpts = {
  page?: number;
  limit?: number;
  projectId?: string;
};

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
};

export interface ReviewRepo {
  create(data: NewReview): Promise<Review>;
  findById(id: string): Promise<Review | null>;
  findByIdempotencyKey(key: string): Promise<Review | null>;
  updateCompleted(id: string, data: ReviewCompletion): Promise<void>;
  listByTenant(tenantId: string, opts: PaginationOpts): Promise<PaginatedResult<Review>>;
  createFinding(data: NewReviewFinding): Promise<void>;
  createFindings(data: NewReviewFinding[]): Promise<void>;
  findFindingsByReviewId(reviewId: string): Promise<ReviewFinding[]>;
}

export function createReviewRepo(db: DrizzleInstance): ReviewRepo {
  return {
    async create(data) {
      const result = await db.insert(reviews).values(data).returning();
      return result[0];
    },

    async findById(id) {
      const result = await db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
      return result[0] ?? null;
    },

    async findByIdempotencyKey(key) {
      const result = await db.select().from(reviews).where(eq(reviews.idempotencyKey, key)).limit(1);
      return result[0] ?? null;
    },

    async updateCompleted(id, data) {
      await db
        .update(reviews)
        .set({
          status: data.status,
          hunksProcessed: data.hunksProcessed,
          tokenUsage: data.tokenUsage,
          timings: data.timings,
          error: data.error,
          completedAt: data.completedAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(reviews.id, id));
    },

    async listByTenant(tenantId, opts) {
      const page = opts.page ?? 1;
      const limit = opts.limit ?? 20;
      const offset = (page - 1) * limit;

      const conditions = [eq(reviews.tenantId, tenantId)];
      if (opts.projectId) {
        conditions.push(eq(reviews.adoProjectId, opts.projectId));
      }
      const where = and(...conditions);

      const [data, countResult] = await Promise.all([
        db
          .select()
          .from(reviews)
          .where(where!)
          .orderBy(desc(reviews.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(reviews)
          .where(where!),
      ]);

      return {
        data,
        total: countResult[0]?.count ?? 0,
        page,
        limit,
      };
    },

    async createFinding(data) {
      await db.insert(reviewFindings).values(data);
    },

    async createFindings(data) {
      if (data.length === 0) return;
      await db.insert(reviewFindings).values(data);
    },

    async findFindingsByReviewId(reviewId) {
      return db.select().from(reviewFindings).where(eq(reviewFindings.reviewId, reviewId));
    },
  };
}
