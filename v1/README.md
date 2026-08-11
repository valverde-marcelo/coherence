# Rede P2P — núcleo Opção B (Hypercore) + Electron

Primeira fatia funcional da rede social distribuída, usando **Hypercore/Corestore/Hyperbee**
como motor do log de posts (em vez de mensagens `GET_PROFILE`/`GET_POST` na mão) e um
shell **Electron** por cima.

## ⚠️ Antes de tudo: sua chave pública mudou de formato

No protótipo original, a "chave pública" que você compartilhava com amigos era o Ed25519
raw (32 bytes). O **Corestore não suporta mais o modo "compat"** que preservaria isso
(testamos — ele força `compat: false` internamente, "no compat for now" no próprio código
deles). Então agora a chave que você compartilha é o `core.key` do Hypercore: um hash do
manifesto (que internamente contém a mesma chave Ed25519 de sempre — a *identidade*
criptográfica continua a mesma, só o endereço público mudou de formato).

Na prática: se você já tinha testado o protótipo antigo com algum amigo, vão precisar
trocar a nova chave (visível no topo da barra lateral do app) antes de se seguirem de novo.
Seu `identity.json` (par de chaves Ed25519) continua sendo reaproveitado — não é preciso
recriar identidade nenhuma.

## O que já está implementado

- **`src/identity.js`** — carrega/gera o par Ed25519 (mesma lógica do protótipo original)
  e converte para o formato `{publicKey, secretKey}` que o Hypercore espera.
- **`src/p2p-node.js`** — a classe `P2PNode`:
  - Um Hyperbee (B-tree assinado sobre um Hypercore) por usuário, com duas famílias de
    chave: `profile` (nome/bio/avatar/lista de quem você segue) e `post!<seq>` (posts,
    texto ou imagem em base64).
  - `follow(chave)` carrega o Hypercore da pessoa (somente leitura) via Corestore e entra
    no tópico dela no Hyperswarm com `{server: true, client: true}` — isso é o que faz
    este nó **semear** o perfil seguido para terceiros, mesmo com o dono offline.
  - Toda verificação de assinatura/integridade da cadeia é feita pelo próprio Hypercore
    durante a replicação — não escrevemos isso na mão.
  - `getFeed()` mistura posts próprios + de quem você segue, por ordem cronológica.
- **`main.js` / `preload.js`** — processo main do Electron hospeda o `P2PNode`; o
  renderer só fala com ele via IPC (`contextIsolation: true`, `nodeIntegration: false`).
- **`renderer/`** — feed, formulário de publicar (texto + imagem), seguir por chave,
  editar perfil, contador de peers conectados.
- **Recuperação de identidade** — o backup `identity.json` inclui a chave do Hypercore.
  Ao importar em uma instalação sem `corestore`, o app aguarda um seeder, recupera perfil,
  posts e seguidores e **só então** cria o `corestore` local e libera escrita. Enquanto a
  identidade não for recuperada da rede, o usuário **nunca** tem acesso a ela: cancelar/fechar
  durante a recuperação remove a importação pendente (o próximo início volta para as boas-vindas),
  e um crash no meio do processo volta para a tela de recuperação. Sem seeder, a opção
  "começar do zero" agora gera uma **identidade nova** (descarta a chave importada).

## Como rodar

```bash
npm install
npm start          # abre o app Electron
```

Para recuperar uma conta em outra instalação, importe apenas o `identity.json` exportado.

## Múltiplas instâncias e usuários locais

Os dados de cada identidade ficam isolados em `coherence-data/<chave-publica>`. A aplicação não usa bloqueio de instância, portanto contas diferentes podem ser executadas ao mesmo tempo.

Quando houver mais de uma conta local, informe a chave pública da conta que será aberta:

```bash
npm start -- --user-key <chave-publica-hexadecimal>
```

Para abrir o fluxo de criação de uma nova conta mesmo quando já existem contas locais, use `--new-user`:

```bash
npm start -- --new-user
```

Também é possível usar o script dedicado, que evita que o npm interprete a opção como configuração:

```bash
npm run new-user
```

O reset pela interface e `npm run reset` removem apenas a conta atual. Com várias contas, o reset via terminal precisa indicar a chave:

```bash
npm run reset -- --user-key=<chave-publica-hexadecimal>
```

Para remover todos os usuários locais, use exclusivamente o comando de linha de comando:

```bash
npm run reset-all
```
O aplicativo aguardará um seeder que tenha o seu Hypercore; depois do timeout, a opção
"começar do zero" gera uma **identidade nova** (a chave importada não é reaproveitada).

## Testes automatizados

```bash
npm test
```

Isso roda testes de integração reais (`test/`) contra uma **DHT local isolada**
(`hyperdht/testnet`, sem precisar de internet), cobrindo:

- `test-posts-and-unfollow.js` — validação de posts (texto/imagem/limite de tamanho) e follow/unfollow.
- `test-integration-follow-sync.js` — Bob segue Alice, sincroniza o histórico e recebe posts novos em tempo real.
- `test-integration-seeding.js` — **o requisito de semeadura**: Bob segue Alice, Alice fica
  offline, Carol passa a seguir Alice mesmo assim e recebe os posts dela através do Bob.
- `test-persistence.js` — identidade, posts e lista de seguidos sobrevivem a um reinício do app.
- `test-followers-records.js` — registros de seguidores persistem após reinícios.
- `test-restart-after-stop-race.js` — leitura concorrente durante stop e primeiro post após reabertura.
- `test-identity-recovery.js` — recuperação de perfil, posts e seguidores usando apenas `identity.json`.
- `test-recovery-timeout.js` — timeout sem seeder e fallback para um core novo.
- `test-import-cancel-no-corestore.js` — importar sem seeder e cancelar não cria `corestore`;
  recuperar com seeder promove o storage e grava o marcador de recuperação.

Todos passando no momento da entrega.

## O que falta (próximos passos sugeridos)

- **Imagens maiores**: hoje ficam embutidas em base64 dentro do post, com limite de ~400KB.
  Evoluir para blobs referenciados por hash (`hyperblobs`/`hyperdrive`) quando isso virar gargalo.
- **Avatar de perfil** — campo já existe no modelo de dados, falta UI pra definir.
- **Paginação do feed** — hoje `getFeed()` lê tudo; ok para poucos posts, precisa de
  range/`limit` real conforme o histórico cresce.
- **Multi-dispositivo** — não escreva na mesma identidade simultaneamente em duas máquinas.
  A recuperação baixa o histórico de um seeder e só depois reabre o core para escrita.
- **Relay de fallback** — para CGNAT duplo, quando o hole punching não for suficiente
  (Hyperswarm já tenta UPnP/hole punching sozinho, mas não há um relay configurado ainda).
- **Bloqueio/mute local** — não há moderação; como os posts são imutáveis, isso só faz
  sentido como filtro do lado de quem lê.
- **Barra de título customizada** — hoje usa o chrome nativo do SO (funcional, não é o foco desta fase).

## Estrutura

```
p2p-social/
├── main.js              # processo main do Electron
├── preload.js            # ponte segura (contextBridge) pro renderer
├── src/
│   ├── identity.js        # chave Ed25519 -> keyPair do Hypercore
│   └── p2p-node.js         # núcleo P2P: Corestore + Hyperbee + Hyperswarm
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
└── test/                  # 4 testes de integração (ver acima)
```

`preview-da-interface.png`, ao lado deste README, é um screenshot automático (capturado
num display virtual durante o desenvolvimento) só para conferência visual — a fonte e o
render exatos podem variar um pouco na sua máquina.
