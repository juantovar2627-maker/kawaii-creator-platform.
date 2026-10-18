import type { User } from "@/lib/db/schema";

// Server authentication still needs the hash; browser account views never do.
export function publicUser(user: User | null) {
  if (!user) return null;
  const { id, name, email, role, createdAt, updatedAt, deletedAt } = user;
  return { id, name, email, role, createdAt, updatedAt, deletedAt };
}
