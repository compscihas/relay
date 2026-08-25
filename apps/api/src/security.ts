import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import type { Database } from "./db/index.js";
import { memberships } from "./db/schema.js";

export interface AccessClaims { sub: string; type: "access" }

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export async function requireUser(app: FastifyInstance, request: FastifyRequest): Promise<string> {
  try {
    const claims = await request.jwtVerify<AccessClaims>();
    if (claims.type !== "access" || !claims.sub) throw new Error("Invalid token type");
    return claims.sub;
  } catch {
    throw app.httpErrors.unauthorized("A valid access token is required");
  }
}

export async function requireMembership(db: Database, userId: string, applicationId: string) {
  const membership = await db.query.memberships.findFirst({
    where: (m, { and, eq }) => and(eq(m.userId, userId), eq(m.applicationId, applicationId)),
  });
  if (!membership) return null;
  return membership;
}

