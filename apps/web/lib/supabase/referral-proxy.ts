import { NextResponse, type NextRequest } from "next/server";

const REF_COOKIE = "ref_code";
const REF_VALIDITY_DAYS = 30;

/** Grava o código de indicação (?ref=CODIGO) num cookie de 30 dias, em qualquer página coberta pelo proxy. */
export function captureReferralCode(request: NextRequest, response: NextResponse) {
  const ref = request.nextUrl.searchParams.get("ref");
  if (!ref) return response;

  const code = ref.trim().toUpperCase().slice(0, 16);
  if (!/^[A-Z0-9]{4,16}$/.test(code)) return response;

  response.cookies.set(REF_COOKIE, code, { maxAge: 60 * 60 * 24 * REF_VALIDITY_DAYS, path: "/", sameSite: "lax" });
  return response;
}
