# Instalação local da versão com correções de segurança

Este procedimento usa o fork `https://github.com/risaddex/dsh-gitea`, branch
`security/local-hardening`, baseado na release upstream `v0.7.39`, commit
`abfd9522e76d21f0a62d1e1514d4ffb740e4964d`. A versão do pacote corrigido é
`0.7.39-security.1`. Ela não foi publicada no npm: instale o tarball gerado
localmente. O atualizador pelo painel foi desativado para preservar as correções.

## 1. Pré-requisitos

- Linux, macOS ou Windows com WSL e shell Bash.
- Git, Node.js 24 LTS e npm. Os testes desta alteração foram executados em Node 24.
- DSH CLI e pnpm instalados e funcionais; mantenha a versão do DSH já usada por
  você. O pacote é um plugin do DeepSeek Harness, não um servidor Gitea.
- Uma instância Gitea/Forgejo e um repositório de teste para a verificação funcional.

```bash
git --version
node --version
npm --version
dsh --version
pnpm --version
dsh plugin --help
```

A gramática de `dsh plugin --profile web add <pacote>` e o encaminhamento de
argumentos ao pnpm foram conferidos no código do CLI `@deepseek-ai/dsh@0.2.1-rc.5`.
Não foi realizado um teste completo com DSH Web e uma instância Gitea reais.
Se seu CLI não aceitar essa gramática, consulte `dsh plugin --help` antes de prosseguir.

## 2. Obter e verificar o código

```bash
git clone --branch security/local-hardening https://github.com/risaddex/dsh-gitea.git
cd dsh-gitea
git status --short
git rev-parse HEAD
git merge-base --is-ancestor abfd9522e76d21f0a62d1e1514d4ffb740e4964d HEAD
git diff abfd9522e76d21f0a62d1e1514d4ffb740e4964d --stat
```

Anote o SHA de `HEAD` aprovado após revisar o diff. Para reproduzir a instalação
mais tarde, use `git checkout --detach SEU_SHA_APROVADO` em vez de confiar no estado
futuro da branch. O comando `merge-base` deve terminar com código zero.

```bash
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run test:leaks
npm audit --omit=dev --legacy-peer-deps
```

`--legacy-peer-deps` instala aqui apenas a dependência de execução travada no
`package-lock.json`; os serviços DSH usados como peers são fornecidos pelo host na
instalação do plugin. O scanner procura formatos conhecidos de credenciais e não
garante a ausência de todos os tipos de segredo. O audit consulta a base do npm no
momento da execução; interrompa a instalação se aparecer uma vulnerabilidade a avaliar.

## 3. Gerar o pacote e registrar sua integridade

Na mesma pasta do clone:

```bash
mkdir -p .artifacts
npm pack --ignore-scripts --pack-destination .artifacts
export DSH_GITEA_TGZ="$PWD/.artifacts/goodandready-dsh-gitea-0.7.39-security.1.tgz"
node --input-type=module <<'JS'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
console.log(createHash('sha256').update(readFileSync(process.env.DSH_GITEA_TGZ)).digest('hex'))
JS
tar -tzf "$DSH_GITEA_TGZ"
```

Guarde o SHA do commit e o SHA-256 do tarball juntos. Confira que o pacote inclui
`lib/action-card-styles.js` e este runbook; não deve conter `.env`, chaves privadas
ou arquivos de credenciais. Gerar novamente o pacote não substitui a conferência
da origem do código.

## 4. Instalar em um ambiente DSH local separado

Pare o processo DSH de teste antes de alterar suas dependências. Para a primeira
instalação, use um `DSH_HOME` dedicado, que não reutiliza o perfil e as credenciais
do seu DSH habitual. Execute os comandos seguintes no mesmo terminal:

```bash
export DSH_HOME="$HOME/.dsh-gitea-security-local"
dsh plugin --profile web add "$DSH_GITEA_TGZ" --ignore-scripts
dsh plugin --profile web list @goodandready/dsh-gitea --depth 0
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const installed = join(process.env.DSH_HOME, 'profiles/web/node_modules/@goodandready/dsh-gitea')
const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
assert.equal(manifest.version, '0.7.39-security.1')
for (const file of ['lib/index.js', 'lib/mirror-dashboard.js', 'lib/webhook-sandbox.js', 'lib/plugin-updater.js', 'lib/action-cards.js', 'lib/action-card-styles.js']) {
  const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
  assert.equal(hash(join(installed, file)), hash(file), `Arquivo diferente: ${file}`)
}
console.log('Versão e arquivos de segurança instalados conferem com o clone revisado.')
JS
```

Não use `dsh plugin --profile web add @goodandready/dsh-gitea`: esse comando baixa
o pacote upstream do npm. Não use o atualizador do painel para esta versão.
O `package-lock.json` do clone trava as dependências de desenvolvimento/verificação;
o host resolve a dependência `semver` na versão exata fixada no manifest e registra
sua integridade no próprio lockfile. Preserve também o lockfile criado no perfil DSH.

## 5. Iniciar e configurar

Abra o DSH a partir de um workspace de teste, mantendo `DSH_HOME` definido:

```bash
dsh --profile web --help
dsh --profile web --port 18080
```

Use o endereço local mostrado pelo DSH. Mantenha o acesso restrito a loopback;
se o serviço estiver ouvindo em `0.0.0.0` ou `::`, ajuste o bind conforme a ajuda da
sua versão antes de abrir acesso de rede. Não exponha a porta por túnel ou proxy.
No Linux, `ss -ltnp` permite conferir o endereço de escuta; no macOS, use
`lsof -nP -iTCP:18080 -sTCP:LISTEN`.

No painel do DSH:

1. Em **Credentials**, crie `GITEA_TOKEN` com um token restrito ao repositório de
   teste e apenas às operações necessárias. Comece com permissões de leitura.
2. Em **Settings → Plugins → Gitea**, configure `baseUrl` com a URL HTTPS da sua
   instância e `tokenEnv` com a referência `GITEA_TOKEN`, nunca com o valor do token.
3. Defina `defaultOwner` e `defaultRepo` para o repositório de teste.
4. Deixe `gitWrapper` vazio para bloquear o fallback de push local. Isso não
   bloqueia alterações pela API: estas continuam limitadas pelas permissões do token.
5. Mantenha `notifyWebhook` e `bgSchedulerWebhook` vazios e `bgSchedulerEnabled`
   desativado na primeira avaliação.
6. Se não for usar webhooks, deixe `webhookSecretEnv` vazio. O endpoint recusa os
   eventos enquanto não houver um segredo válido configurado.

Se precisar de webhooks, crie uma credencial separada para o segredo e informe
apenas sua referência em `webhookSecretEnv`. Configure o mesmo segredo no Gitea.
Gitea em outra máquina não alcança um DSH limitado a loopback: não abra a porta
apenas para este teste. Planeje esse acesso separadamente com autenticação e TLS.

## 6. Critérios de aceite

- O painel reconhece `0.7.39-security.1` e não oferece atualização automática.
- `gitea_whoami` e uma listagem de issues do repositório de teste funcionam.
- Os cartões de issue, PR e branch aparecem sem baixar scripts externos; confira
  a aba Network das ferramentas do navegador.
- `gitea_mirror_sync_status` com `action: sync` sem `confirm: true` não faz alterações.
- Um push local de mirror sem wrapper configurado é recusado. A sincronização
  pela API pode funcionar sem wrapper se o token tiver a permissão necessária.
- A ferramenta `gitea_webhook_sandbox` exige `confirm: true` para replay e limpeza.
  Eventos com assinatura inválida não podem ser reproduzidos e têm `payload: null`.
- Replay de evento validado ou sintético confirmado atualiza os eventos locais e
  o barramento de metadados, mas não chama o despachante de notificações externas.

O replay ainda avisa assinantes locais do barramento. Outros plugins podem reagir
a esses metadados; faça a primeira avaliação sem integrações adicionais.
A filtragem de segredos é uma defesa adicional baseada em padrões: conteúdo de
webhooks válidos pode conter informações privadas que não correspondem a esses
padrões. Não envie credenciais em títulos, comentários ou mensagens de commit.

Para habilitar escrita Git posteriormente, configure o caminho absoluto de um
wrapper revisado e verifique o remoto com `git remote get-url github` no workspace
correto. A versão corrigida aceita apenas nomes de remotos já configurados, usa
refspec explícito e não faz force-push. Teste inicialmente com um remoto descartável.

## 7. Atualizar, remover ou voltar ao perfil habitual

Para atualizar o fork: revise o novo commit, execute novamente os testes, gere
outro tarball e instale-o com o caminho absoluto, após parar o DSH de teste.
Guarde o tarball anterior; ele permite restaurar a versão revisada pelo mesmo
comando `dsh plugin --profile web add /caminho/absoluto/pacote-anterior.tgz --ignore-scripts`.

Para remover apenas o plugin do ambiente de teste:

```bash
dsh plugin --profile web remove @goodandready/dsh-gitea
```

Depois de parar o processo de teste, abra um novo terminal para usar seu ambiente
DSH habitual. Se você usa um `DSH_HOME` personalizado, volte ao valor anterior.
Revogue o token de teste na instância Gitea quando terminar. Nenhuma etapa deste
runbook publica o pacote no npm nem modifica repositórios de produção.

## 8. Problemas comuns

| Sintoma | Ação |
| --- | --- |
| `pnpm was not found` | Instale o pnpm conforme a documentação da sua instalação DSH e confira o PATH. |
| Erro de peer dependency ou plugin não aparece | Confira a compatibilidade da versão DSH com os peers em `package.json`; não force versões incompatíveis. |
| Versão continua `0.7.39` | Confira `DSH_HOME`, o perfil `web`, o caminho do tarball e reinicie o processo correto; faça hard-refresh. |
| `Local mirror push requires a configured gitWrapper` | O bloqueio é esperado. Configure um wrapper revisado somente se realmente precisar de escrita Git local. |
| Webhook retorna `401` | Confira a referência da credencial, o segredo compartilhado e a assinatura HMAC; não desative a verificação. |
| Rotas retornam `403` | Use o endereço local autenticado do DSH; confira origem e sessão. Não remova as proteções das rotas. |
| Scanner ou audit falha | Revise o diagnóstico antes de instalar; o scanner não imprime valores suspeitos. |
