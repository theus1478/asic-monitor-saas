import type { NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/proxy";
import { captureReferralCode } from "./lib/supabase/referral-proxy";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  return captureReferralCode(request, response);
}

export const config = {
  matcher: ["/", "/dashboard/:path*", "/farms/:path*", "/billing/:path*", "/admin/:path*", "/sign-in", "/affiliate/:path*"],
};
