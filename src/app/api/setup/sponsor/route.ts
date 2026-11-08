import { sponsor } from "@/lib/sponsor";

export const dynamic = "force-dynamic";

/** POST /api/setup/sponsor: the faucet-funded account creation that /setup uses. */
export async function POST(req: Request) {
  return sponsor(req);
}
