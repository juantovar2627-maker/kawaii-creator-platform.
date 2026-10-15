import type { User } from "@/lib/db/schema";

// Server authentication still needs the hash; browser account views never do.
export function publicUser(user: User | null) {
  if (!user) return null;
  const { passwordHash: _passwordHash, ...profile } = user;
  return profile;
}
