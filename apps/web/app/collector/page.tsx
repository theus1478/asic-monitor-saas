import Link from "next/link";
import { PageHeader, Shell } from "../components";

export default function CollectorPage() {
  return <Shell><PageHeader title="Coletor local" description="Instale uma vez no computador principal de cada fazenda." action={<a className="button download-button" href="/downloads/ASICMonitorAgent.exe" download>⇣ Baixar para Windows</a>} />
    <section className="collector-hero card"><div><p className="eyebrow">ASIC MONITOR AGENT</p><h2>Conecta sua rede local à nuvem com segurança</h2><p>O executável roda em segundo plano, consulta apenas os IPs cadastrados e envia telemetria pela conexão de saída. Nenhuma porta da fazenda precisa ficar exposta.</p><div className="collector-meta"><span>Windows 10/11</span><span>Sem interface</span><span>Atualização a cada 30s</span></div></div><div className="collector-glyph">⇣</div></section>
    <section className="steps-grid"><article className="card"><b>01</b><h3>Crie a fazenda</h3><p>Cadastre o local e abra a página de monitoramento.</p></article><article className="card"><b>02</b><h3>Gere o token</h3><p>Na página da fazenda, abra “Coletor” e gere uma credencial.</p></article><article className="card"><b>03</b><h3>Instale o agente</h3><p>Execute o arquivo como administrador e informe URL e token.</p></article><article className="card"><b>04</b><h3>Cadastre os IPs</h3><p>O agente baixa a lista automaticamente e começa a coleta.</p></article></section>
    <section className="card collector-help"><div><h2>Pronto para configurar?</h2><p className="muted">Escolha uma fazenda, abra o botão “Coletor” e copie o token de instalação.</p></div><Link href="/farms" className="button secondary">Escolher fazenda</Link></section>
  </Shell>;
}
