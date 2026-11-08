import { sessionInfo, signIn, signOutResponse } from "@/lib/historyApi";

export const dynamic = "force-dynamic";

/** Who this browser is signed in as, and a fresh message for the wallet to sign. */
export const GET = (req: Request) => sessionInfo(req);
/** Signs in with a NEAR wallet's signed message, and moves this browser's runs to that account. */
export const POST = (req: Request) => signIn(req);
export const DELETE = () => signOutResponse();
