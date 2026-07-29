# Coherence - Rede Social P2P Distribuída

Uma rede social distribuída baseada em tecnologia P2P (peer-to-peer) utilizando **Hyperswarm**, **Hypercore** e **Hyperbee**. Sem servidores centralizados, sem censura, sem dados coletados.

## 🌍 Visão Geral

**Coherence** é uma plataforma de rede social onde:
- Cada usuário controla seus próprios dados
- Todos os dados são criptograficamente assinados (Ed25519)
- Conexões P2P diretas entre peers via Hyperswarm
- Dados replicados em múltiplas máquinas automaticamente
- Interface desktop com Electron

## 🚀 Características

- ✅ **Identidade Descentralizada**: Cada usuário gera seu próprio keypair Ed25519
- ✅ **Posts Imutáveis**: Todos os posts assinados e armazenados em Hypercores
- ✅ **Perfil Distribuído**: Nome, bio, avatar e links salvos em Hyperbee
- ✅ **Sistema de Seguir/Deixar de Seguir**: Seguidores são detectados via conexões P2P
- ✅ **Descoberta de Peers**: Automaticamente descobre e conecta com usuários seguidos
- ✅ **Interface Intuitiva**: 3 colunas (Perfil, Feed, Seguidores) em Electron
- ✅ **Persistência**: Dados salvos localmente em `~/.p2p-social/`

## 📁 Estrutura do Projeto

```
coherence/
├── v0/                          # Prototipo inicial
│   ├── app-p2p.js
│   └── package.json
├── v1/                          # Versão atual (Electron + UI)
│   ├── main.js                  # Processo principal Electron
│   ├── preload.js               # Bridge IPC seguro
│   ├── src/
│   │   ├── p2p-node.js          # Núcleo P2P (Hyperswarm/Hypercore/Hyperbee)
│   │   └── identity.js          # Geração e gestão de keypairs
│   ├── renderer/
│   │   ├── index.html           # Interface (3 colunas)
│   │   ├── renderer.js          # Lógica frontend
│   │   └── styles.css           # Estilos CSS
│   ├── test/                    # Testes de integração
│   ├── scripts/
│   │   └── reset.js             # Script para resetar dados
│   └── package.json
├── docs/                        # Landing page GitHub Pages
└── README.md
```

## 🛠️ Tecnologia

| Componente | Tecnologia | Propósito |
|-----------|-----------|----------|
| **P2P Network** | Hyperswarm | Descoberta e conexão entre peers |
| **Armazenamento** | Hypercore | Logs imutáveis e criptografados |
| **Índice** | Hyperbee | Estrutura de dados distribuída (B-tree) |
| **Desktop** | Electron | Interface nativa multiplataforma |
| **Criptografia** | Ed25519 | Assinatura digital de dados |

## 📦 Instalação

### Requisitos
- Node.js 16+
- npm ou yarn

### Setup

```bash
# Clonar repositório
git clone https://github.com/seu-usuario/coherence.git
cd coherence/v1

# Instalar dependências
npm install

# Iniciar aplicação
npm start
```

## 🎮 Uso

### Primeira Execução
1. Abra a aplicação com `npm start`
2. Sua chave pública será gerada automaticamente
3. Edite seu perfil (nome, bio, avatar, links)
4. Comece a postar!

### Seguir Usuários
1. Cole a chave pública de um amigo na aba "Seguindo"
2. Você será conectado automaticamente quando ambos estiverem online
3. Seus posts e perfil serão replicados

### Ver Seguidores
1. Clique na aba "Seguidores" na barra lateral direita
2. Todos que se conectaram ao seu node aparecerão
3. Clique no nome para visualizar o perfil completo

## 🔄 Sincronização de Dados

Os dados são replicados através:

1. **Replicação Automática**: Quando dois peers conectam, dados são sincronizados
2. **Polling Inteligente**: Atualização de perfis e posts a cada 10 segundos
3. **Detecção de Peers**: Novos seguidores são detectados em tempo real
4. **Persistência Local**: Tudo é salvo em `~/.p2p-social/`

## 🧪 Testes

```bash
# Executar suite de testes
npm test

# Testes incluem:
# - test-posts-and-unfollow.js      → Posts e deixar de seguir
# - test-integration-follow-sync.js  → Sincronização de seguimento
# - test-integration-seeding.js      → Seeding de dados
# - test-persistence.js              → Persistência de dados
```

## 🔐 Privacidade & Segurança

- **Sem Servidor Central**: Dados não são centralizados
- **Criptografia End-to-End**: Dados assinados com Ed25519
- **Controle Total**: Você controla seus dados completamente
- **Privacidade por Design**: Peers só podem ler dados que você compartilha

**Nota**: Um peer pode ler seu perfil e posts se souber sua chave pública. Isso é por design - você escolhe com quem compartilhar sua chave.

## 💾 Reset Completo

Para limpar todos os dados e começar do zero:

```bash
npm run reset
npm start
```

Isso removes:
- Identidade (keypair)
- Todos os posts
- Perfil
- Lista de seguimento
- Cache

## 🐛 Debugging

Logs são exibidos no console durante execução:

```
[swarm:connection] Socket conectado de peer: ...
[getProfile] Buscando perfil de: ...
[getFollowers] Retornando X seguidores
```

## 📝 Roadmap

- [ ] Web UI (Além de Electron)
- [ ] Suporte a media (imagens/vídeos)
- [ ] Sistema de reações/curtidas
- [ ] Notificações em tempo real
- [ ] Busca distribuída
- [ ] DHT melhorado
- [ ] Mobile app (React Native)

## 📄 Licença

MIT - Veja [LICENSE](LICENSE) para detalhes

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📧 Contato

Para dúvidas ou sugestões, abra uma issue no repositório.

---

**Coherence** - Comunicação descentralizada, sem limites. 🌐
