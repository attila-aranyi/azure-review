import { eq } from "drizzle-orm";
import type { DrizzleInstance } from "../connection";
import { reviewFeedback } from "../schema";

export type FeedbackRow = typeof reviewFeedback.$inferSelect;

export interface FeedbackRepo {
  create(data: { findingId: string; tenantId: string; adoUserId?: string; vote: "up" | "down"; comment?: string }): Promise<FeedbackRow>;
  findByFindingId(findingId: string): Promise<FeedbackRow[]>;
  getStats(tenantId: string): Promise<{ totalUp: number; totalDown: number }>;
}

export function createFeedbackRepo(db: DrizzleInstance): FeedbackRepo {
  return {
    async create(data) {
      const result = await db
        .insert(reviewFeedback)
        .values(data)
        .returning();
      return result[0];
    },

    async findByFindingId(findingId) {
      return db
        .select()
        .from(reviewFeedback)
        .where(eq(reviewFeedback.findingId, findingId));
    },

    async getStats(tenantId) {
      const all = await db
        .select()
        .from(reviewFeedback)
        .where(eq(reviewFeedback.tenantId, tenantId));
      const totalUp = all.filter((f) => f.vote === "up").length;
      const totalDown = all.filter((f) => f.vote === "down").length;
      return { totalUp, totalDown };
    },
  };
}
