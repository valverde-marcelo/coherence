1. Inspeção de Enxame (Swarm Inspection)
Como funciona no Hypercore: A camada de rede e descoberta de pares do Hypercore é gerenciada pelo módulo Hyperswarm.  

Implementação:

O autor publica seu log (feed) anunciando no Hyperswarm uma discoveryKey (que é um hash criptográfico BLAKE2b da chave pública do seu Hypercore).  

Quando os seguidores tentam ler ou sincronizar o feed, eles se conectam ao enxame do Hyperswarm associado a essa discoveryKey.  

O aplicativo do autor consegue inspecionar em tempo real o array de conexões ativas (core.peers ou swarm.connections). Durante o handshake inicial de conexão, as identidades criptográficas e os endereços IP dos receptores ficam imediatamente acessíveis para o nó do autor.  

2. Registros de "Follow" em Logs Append-Only (A solução principal do Hypercore)
Como funciona no Hypercore: O Hypercore é, em sua essência, um log distribuído e imutável que só permite anexar dados (append-only log). Cada usuário é o único detentor da chave privada do seu próprio log.  

Implementação:

Quando o Usuário B clica para seguir o Usuário A, o aplicativo de B executa um core.append() no seu próprio Hypercore, gravando um bloco com a instrução: { type: 'follow', target: publicKey_A }.  

Para que o Usuário A (ou qualquer outro usuário) descubra quem são os seus seguidores, utilizam-se estruturas de banco de dados construídas sobre o Hypercore, como o Hyperbee ou Hypertrie (que transformam logs ordenados em índices chave-valor).  

Índices locais ou nós leitores (indexers) percorrem os logs dos pares conhecidos na rede social para mapear as conexões "quem segue quem", criando um grafo social totalmente descentralizado e verificável por assinaturas digitais.  

3. Confirmações de Leitura no Nível de Bloco (Read Receipts)
Como funciona no Hypercore: O protocolo de replicação do Hypercore opera solicitando blocos específicos de dados por índice sequencial (seq).  

Implementação:

Quando o aplicativo do Usuário B tenta renderizar uma publicação do Usuário A, o cliente de B envia uma requisição get(index) via stream P2P para obter aquele bloco específico.  

O aplicativo do Usuário A intercepta esse evento no próprio stream de replicação do seu Hypercore.  

Como a solicitação de bloco é associada ao par conectado, o nó do autor sabe exatamente no momento em que o seguidor baixou o bloco do post, funcionando como uma confirmação de recebimento/leitura instantânea no nível do protocolo.