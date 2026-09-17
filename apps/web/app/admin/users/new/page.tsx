import Link from "next/link";
import { PageHeader, Shell } from "../../../components";
import { requirePlatformAdmin } from "../../../../lib/org-data";
import { isSuperAdmin } from "../../../../lib/admin/permissions";
import { createUser } from "../actions";

export default async function NewUserPage() {
  await requirePlatformAdmin();
  const canGrantRole = await isSuperAdmin();

  return <Shell admin>
    <PageHeader title="Novo usuário" description="Cadastre uma conta diretamente ou envie um convite por e-mail." action={<Link href="/admin/users" className="button secondary">← Voltar</Link>} />
    <form action={createUser} className="card form-grid" style={{ maxWidth: 560 }}>
      <label>Nome<input name="fullName" required /></label>
      <label>Username (opcional)<input name="username" placeholder="username" /></label>
      <label>E-mail<input name="email" type="email" required /></label>
      {canGrantRole && <label>Acesso admin (opcional)
        <select name="platformRole" defaultValue="">
          <option value="">Usuário comum</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </label>}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
        <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: "auto" }}>
          <input type="checkbox" name="sendInvite" style={{ width: "auto" }} /> Enviar convite por e-mail (o usuário define a própria senha)
        </label>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>Se não marcar, informe uma senha temporária abaixo — o usuário será obrigado a trocá-la no primeiro login.</p>
      </div>
      <label>Senha temporária<input name="tempPassword" type="password" minLength={8} autoComplete="new-password" placeholder="Deixe em branco se for enviar convite" /></label>
      <button className="button" type="submit" style={{ justifySelf: "start" }}>Criar usuário</button>
    </form>
  </Shell>;
}
