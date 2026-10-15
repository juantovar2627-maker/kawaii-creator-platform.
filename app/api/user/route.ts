import { getUser } from "@/lib/db/queries";
import { publicUser } from "@/lib/auth/public-user";

export async function GET() {
  const user = await getUser();
  return Response.json(publicUser(user));
}
