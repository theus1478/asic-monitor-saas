export default function Home() {
  return <main className="shell">
    <nav className="nav">
      <div className="brand"><span className="brand-mark">A</span><span>ASIC <b>Monitor</b></span></div>
      <div className="hero-actions">
        <a className="button secondary" href="/sign-in">Entrar</a>
        <a className="button" href="/sign-in?mode=signup">Criar conta</a>
      </div>
    </nav>
    <section className="hero">
      <p className="eyebrow">PLATAFORMA EM NUVEM</p>
      <h1>Monitoramento de ASICs para fazendas que querem escalar.</h1>
      <p>Um coletor sem interface roda no PC da sua fazenda, lê suas máquinas na rede local e envia os dados para a nuvem. Você acompanha hash rate, temperatura e disponibilidade de qualquer dispositivo, com licença por máquina ativa.</p>
      <div className="hero-actions">
        <a className="button" href="/sign-in?mode=signup">Começar agora</a>
        <a className="button secondary" href="/farms">Baixar o coletor</a>
      </div>
    </section>
    <section className="grid">
      <article className="card"><div className="muted">Coleta local</div><div className="metric">Segura</div><p className="muted">Executável sem interface, sem abrir portas da fazenda.</p></article>
      <article className="card"><div className="muted">Acesso</div><div className="metric">Multiusuário</div><p className="muted">Equipe e clientes acessam o mesmo painel em qualquer navegador.</p></article>
      <article className="card"><div className="muted">Licença</div><div className="metric">Por máquina</div><p className="muted">Assinatura mensal com cobrança progressiva por ASIC ativa.</p></article>
    </section>
    <section className="landing-section">
      <h2>Como funciona</h2>
      <p>Da conta até o painel em produção, em quatro passos.</p>
      <ol className="steps">
        <li><b>01</b>Crie sua conta e cadastre a fazenda.</li>
        <li><b>02</b>Baixe e instale o coletor no PC principal.</li>
        <li><b>03</b>Cadastre as ASICs pelo endereço IP local.</li>
        <li><b>04</b>Acompanhe hash rate e alertas em tempo real.</li>
      </ol>
    </section>
    <section className="landing-section">
      <h2>Cobrança transparente</h2>
      <p>US$ 3,00 por máquina ativa/mês, com desconto progressivo a partir da 15ª máquina. Pagamento em USDT na rede Solana, com confirmação automática na blockchain — sem depender de exchange.</p>
      <a className="text-link" href="/sign-in?mode=signup">Ver a calculadora de licença →</a>
    </section>
    <footer className="footer">
      <span>ASIC Monitor Cloud</span>
      <span>Pagamentos em USDT · Rede Solana</span>
    </footer>
  </main>;
}
