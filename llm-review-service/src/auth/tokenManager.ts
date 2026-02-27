import { eq, lte } from "drizzle-orm";
import { z } from "zod";
import { request } from "undici";
import type { DrizzleInstance } from "../db/connection";
import { tenants, tenantOauthTokens } from "../db/schema";
import { encrypt, decrypt } from "./encryption";

export type OAuthTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

// MED-15: Validate token response shape
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export type RefreshResult = {
  tenantId: string;
  success: boolean;
  error?: string;
};

export class TokenManager {
  constructor(
    private readonly db: DrizzleInstance,
    private readonly encryptionKey: Buffer,
    private readonly tokenEndpoint: string = "https://app.vssps.visualstudio.com/oauth2/token",
    private readonly clientId?: string,
    private readonly clientSecret?: string,
    private readonly redirectUri?: string,
  ) {}

  // MED-3: Use upsert to avoid race condition
  async storeTokens(tenantId: string, tokens: OAuthTokenResponse): Promise<void> {
    const accessTokenEnc = encrypt(tokens.access_token, this.encryptionKey).toString("base64");
    const refreshTokenEnc = encrypt(tokens.refresh_token, this.encryptionKey).toString("base64");
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    const existing = await this.db
      .select({ id: tenantOauthTokens.id })
      .from(tenantOauthTokens)
      .where(eq(tenantOauthTokens.tenantId, tenantId))
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(tenantOauthTokens)
        .set({ accessTokenEnc, refreshTokenEnc, expiresAt, updatedAt: new Date() })
        .where(eq(tenantOauthTokens.tenantId, tenantId));
    } else {
      await this.db
        .insert(tenantOauthTokens)
        .values({ tenantId, accessTokenEnc, refreshTokenEnc, expiresAt });
    }
  }

  // HIGH-6: No longer recursive — reads freshly stored token directly after refresh
  async getAccessToken(tenantId: string): Promise<string> {
    const row = await this.db
      .select()
      .from(tenantOauthTokens)
      .where(eq(tenantOauthTokens.tenantId, tenantId))
      .limit(1);

    if (row.length === 0) {
      throw new Error(`No tokens found for tenant ${tenantId}`);
    }

    const token = row[0];
    const bufferMs = 5 * 60 * 1000; // 5 minutes

    if (token.expiresAt.getTime() - Date.now() < bufferMs) {
      await this.refreshToken(tenantId, token.refreshTokenEnc);
      // Read the freshly stored token instead of recursing
      const refreshed = await this.db
        .select()
        .from(tenantOauthTokens)
        .where(eq(tenantOauthTokens.tenantId, tenantId))
        .limit(1);
      if (refreshed.length === 0) {
        throw new Error(`Tokens disappeared after refresh for tenant ${tenantId}`);
      }
      return decrypt(Buffer.from(refreshed[0].accessTokenEnc, "base64"), this.encryptionKey);
    }

    return decrypt(Buffer.from(token.accessTokenEnc, "base64"), this.encryptionKey);
  }

  async refreshAllExpiring(): Promise<RefreshResult[]> {
    const bufferMs = 15 * 60 * 1000; // 15 minutes
    const cutoff = new Date(Date.now() + bufferMs);

    const expiring = await this.db
      .select()
      .from(tenantOauthTokens)
      .where(lte(tenantOauthTokens.expiresAt, cutoff));

    const results: RefreshResult[] = [];

    for (const token of expiring) {
      let lastError: string | undefined;
      let success = false;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // MED-4: Exponential backoff between retries
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          }
          await this.refreshToken(token.tenantId, token.refreshTokenEnc);
          success = true;
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }

      if (!success) {
        await this.db
          .update(tenants)
          .set({ status: "needs_reauth", updatedAt: new Date() })
          .where(eq(tenants.id, token.tenantId));
      }

      results.push({ tenantId: token.tenantId, success, error: lastError });
    }

    return results;
  }

  async revoke(tenantId: string): Promise<void> {
    await this.db.delete(tenantOauthTokens).where(eq(tenantOauthTokens.tenantId, tenantId));
    await this.db
      .update(tenants)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  }

  private async refreshToken(tenantId: string, refreshTokenEnc: string): Promise<void> {
    // MED-5: Throw on missing clientSecret
    if (!this.clientSecret) {
      throw new Error("clientSecret required for token refresh");
    }

    const refreshToken = decrypt(Buffer.from(refreshTokenEnc, "base64"), this.encryptionKey);

    const body = new URLSearchParams({
      client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: this.clientSecret,
      grant_type: "refresh_token",
      assertion: refreshToken,
      redirect_uri: this.redirectUri ?? "",
    });

    const res = await request(this.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const text = await res.body.text();
    if (res.statusCode !== 200) {
      // MED-14: Truncate error response to avoid leaking sensitive data
      const sanitized = text.length > 200 ? text.substring(0, 200) + "...[truncated]" : text;
      throw new Error(`Token refresh failed: ${res.statusCode} ${sanitized}`);
    }

    // MED-15: Validate token response shape before storing
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Token refresh returned invalid JSON");
    }

    const validated = tokenResponseSchema.safeParse(parsed);
    if (!validated.success) {
      throw new Error(`Token refresh returned invalid response: ${validated.error.message}`);
    }

    await this.storeTokens(tenantId, validated.data);
  }
}
