# Serviço coletor local

O coletor será um executável Windows sem interface, configurado para iniciar
automaticamente com o sistema. Ele não abre portas para a internet: somente
envia métricas por HTTPS para a API Cloud.

Na instalação, o cliente fornece um código de ativação gerado pelo painel. Depois
disso, o serviço recebe uma credencial exclusiva e rotativa. Configuração e
diagnóstico ficam no painel web do cliente, sem tela local.

A lógica de leitura cgminer do projeto atual será migrada para este componente, sem copiar IPs, histórico ou configurações da sua fazenda.

## Fonte da lista de máquinas

O `config.json` local não precisa listar as ASICs manualmente. A cada ciclo, o
coletor busca em `GET /api/agent/config` (mesmo token do agente) a lista de
máquinas cadastradas naquela fazenda no painel — nome, IP, porta e fabricante
(`antminer`, `whatsminer` ou `avalon`). O campo `miners` do arquivo local só
serve como fallback caso a busca na nuvem falhe temporariamente.
