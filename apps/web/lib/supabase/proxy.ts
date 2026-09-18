import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedRoutes = ["/dashboard", "/farms", "/billing", "/admin", "/affiliate"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    return response;
  }

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route));

  if (isProtected && !user) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/sign-in";
    signInUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (pathname.startsWith("/admin") && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("platform_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.platform_admin) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  if (pathname === "/sign-in" && user) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // E-mail ainda não confirmado (código de 6 dígitos) — força a tela de
  // verificação antes de liberar qualquer outra página logada. Fica no
  // middleware, não só num layout, pra não dar pra contornar trocando a URL.
  const exemptFromVerification = pathname === "/verify-email" || pathname.startsWith("/auth") || pathname === "/sign-in";
  if (user && !exemptFromVerification && !user.email_confirmed_at) {
    return NextResponse.redirect(new URL("/verify-email", request.url));
  }

  // Senha temporária definida por um admin: exige criar uma senha nova antes
  // de qualquer outra página (também no middleware, não dá pra contornar pela URL).
  const exemptFromPasswordChange = pathname === "/change-password" || pathname.startsWith("/auth") || pathname === "/sign-in" || pathname === "/verify-email";
  if (user && !exemptFromPasswordChange && user.user_metadata?.force_password_change === true) {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  return response;
}
