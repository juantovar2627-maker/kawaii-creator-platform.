import { compare, hash } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { z } from "zod";
import { NewUser } from "@/lib/db/schema";
import { strongSecret } from "@/lib/config/runtime";
function sessionKey() {
  if (!strongSecret(process.env.AUTH_SECRET))
    throw new Error("Session configuration unavailable.");
  return new TextEncoder().encode(process.env.AUTH_SECRET);
}
const sessionSchema = z.object({
  user: z.object({ id: z.number().int().positive() }),
  expires: z
    .string()
    .datetime()
    .refine((value) => new Date(value).getTime() > Date.now()),
  // Existing sessions remain usable only until their account version is revoked.
  version: z.number().int().nonnegative().default(0),
});
type SessionData = z.input<typeof sessionSchema>;
export async function hashPassword(password: string) {
  return hash(password, 10);
}
export async function comparePasswords(
  plainTextPassword: string,
  hashedPassword: string,
) {
  return compare(plainTextPassword, hashedPassword);
}
export async function signToken(payload: SessionData) {
  return new SignJWT(sessionSchema.parse(payload))
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1d")
    .sign(sessionKey());
}
export async function verifyToken(input: string) {
  const { payload } = await jwtVerify(input, sessionKey(), {
    algorithms: ["HS256"],
  });
  return sessionSchema.parse(payload);
}
export async function getSession() {
  const session = (await cookies()).get("session")?.value;
  if (!session) return null;
  try {
    return await verifyToken(session);
  } catch {
    return null;
  }
}
export async function setSession(user: NewUser) {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = await signToken({
    user: { id: user.id! },
    expires: expires.toISOString(),
    version: user.sessionVersion ?? 0,
  });
  (await cookies()).set("session", token, {
    expires,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  });
}
