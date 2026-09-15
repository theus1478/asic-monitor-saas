import Link from "next/link";
import { signIn, signUp } from "../auth/actions";
import { SiteLogo } from "../site-logo";

type Props = { searchParams: Promise<{ mode?: string; error?: string; message?: string; next?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const params = await searchParams;
  const isSignUp = params.mode === "signup";

  return <main className="auth-page">
    <section className="auth-card">
      <SiteLogo href="/" />
      <div className="auth-heading"><p className="eyebrow">PLATAFORMA EM NUVEM</p><h1>{isSignUp ? "Criar sua conta" : "Acessar sua operação"}</h1><p>{isSignUp ? "Cadastre-se para iniciar a configuração da sua fazenda." : "Entre para acompanhar suas ASICs de qualquer dispositivo."}</p></div>
      {params.error && <div className="form-message error">{params.error}</div>}
      {params.message && <div className="form-message success">{params.message}</div>}
      <form action={isSignUp ? signUp : signIn} className="auth-form">
        {isSignUp && <label>Nome completo<input name="fullName" autoComplete="name" required placeholder="Seu nome" /></label>}
        <label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com" /></label>
        <label>Senha<input name="password" type="password" minLength={8} autoComplete={isSignUp ? "new-password" : "current-password"} required placeholder="Mínimo de 8 caracteres" /></label>
        {!isSignUp && <input type="hidden" name="next" value={params.next ?? "/dashboard"} />}
        {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && <div className="cf-turnstile" data-sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} data-theme="dark" />}
        <button className="button auth-submit" type="submit">{isSignUp ? "Criar conta" : "Entrar"}</button>
      </form>
      {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />}
      <p className="auth-switch">{isSignUp ? "Já possui uma conta?" : "Ainda não possui uma conta?"} <Link href={isSignUp ? "/sign-in" : "/sign-in?mode=signup"}>{isSignUp ? "Entrar" : "Criar conta"}</Link></p>
    </section>
  </main>;
}
