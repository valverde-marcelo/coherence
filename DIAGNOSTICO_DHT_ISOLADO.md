# 🔴 Diagnóstico: DHT Isolado (0 Peers)

## O Problema

Quando você rodou a aplicação, os logs mostraram:

```
[app] DHT bootstrap timeout após 30005ms com 0 peers
[dht] dhtNodeCount: 0
[dht] tentativa 1/7 de publicar ponteiro: No nodes to query
```

**Significado:** O DHT (Distributed Hash Table) não conseguiu se conectar a NENHUM nó bootstrap, portanto:
- ❌ **Não consegue publicar** pointers (BEP44 mutable items) → outros usuários não descobrem você
- ❌ **Não consegue resolver** pointers → você não descobre outros usuários
- ❌ **Não consegue encontrar** peers para torrents → posts não sincronizam

## Por Que Isso Acontece?

A rede BitTorrent depende de conectar a nós bootstrap públicos (`router.bittorrent.com:6881`, etc.) via **UDP porta 6881-6889**.

### Causas Possíveis no Seu Ambiente

| Causa | Sintoma | Solução |
|-------|---------|---------|
| **Firewall bloqueando UDP** | `dhtNodeCount: 0` sempre | Abrir portas UDP 6881-6889 ou usar VPN |
| **Rede Corporativa/Restrita** | Nós bootstrap inacessíveis | Solicitar acesso ao admin ou usar tracker fallback |
| **Router não permite UDP  multicast** | LSD (local discovery) também falha | Usar trackers públicos WSS (WebSocket Secure) |
| **Duas redes separadas** (seu cenário) | Peers não se encontram sem intermediário | Usar DHT público (requer UDP aberto) ou relay central |

## Modo de Operação Atual

Com o novo código implementado, a app está em **modo "local only"**:

```
[app] ⚠️  DHT ISOLADO: nenhum peer descoberto
[app] Operando em modo "local only": descoberta via LSD (rede local) apenas
```

### Como Funciona em Modo Local-Only

| Mecanismo | Alcance | Funciona? |
|-----------|---------|-----------|
| **DHT (BEP44)** | Global | ❌ (isolado) |
| **LSD (mDNS)** | Mesma rede local | ✅ Se no mesmo roteador |
| **PEX (Peer Exchange)** | Via peers conhecidos | ⚠️ Depende de encontrar peer primeiro |
| **Trackers** | Global | ✅ Se usar trackers WSS públicos |

## Testando Diferentes Cenários

### Cenário 1: Mesma Rede Local (DEVE FUNCIONAR) ✅

Se ambos os clientes estão no **mesmo Wi-Fi/Ethernet**:

1. **Terminal A (User 1):**
   ```bash
   npm start
   ```
   Criar 1 post → observe logs de `[chapters] sealing...`

2. **Terminal B (User 2):**
   ```bash
   npm start
   ```

3. **Em User B (no app UI):**
   - Adicionar chave pública de User A
   - Observe logs de discovery em User B

4. **Logs Esperados em User B:**
   ```
   [torrent] peer adicionado a <infohash>: via udp (LSD descobriu!)
   [discovery] capítulo baixando...
   [discovery] posts ingeridos...
   ```

**Se isso funciona:** Seu problema é **apenas DHT/trackers**, não LSD/PEX.

---

### Cenário 2: Redes Separadas (PRECISA DE DHT PÚBLICO)

Se dois clientes estão em **redes diferentes** (2G, 4G, VPN, etc):

**Sem DHT público + Trackers, é impossível se descobrirem.**

#### Opção A: Abrir UDP (Resolver Firewall)

```bash
# No router/firewall, abrir:
UDP 6881-6889 (BitTorrent)

# Testar conexão:
netstat -an | findstr :6881  # Deve aparecer
```

#### Opção B: Usar Relay/Bootstrap Central

Para produção, implementar um servidor central que:
- Armazena pointers BEP44 localmente
- Serve como tracker fallback
- Possibilita descoberta sem DHT público

#### Opção C: Usar TracksPublicosWSS (já habilitado)

No `store.js`, há trackers WebSocket Secure:
```javascript
'wss://tracker.btorrent.xyz',
'wss://tracker.openwebtorrent.com'
```

Esses funcionam via **HTTPS WebSocket** (porta 443, normalmente aberta).

---

## Como Verificar Se DHT Está Funcionando

### Log Positivo (DHT OK)

```
[app] DHT peer descoberto #1 (150ms) { nodesSize: 1 }
[app] DHT peer descoberto #2 (300ms) { nodesSize: 5 }
[app] DHT peer descoberto #3 (450ms) { nodesSize: 20 }
[app] DHT pronto: 3+ peers descobertos em 450ms
[dht] tentativa 1/7 de publicar ponteiro: ✅ SUCESSO em 200ms
```

### Log Negativo (DHT Isolado)

```
[app] DHT bootstrap timeout após 30005ms com 0 peers
[app] ⚠️  DHT ISOLADO: nenhum peer descoberto
[dht] tentativa 1/7 de publicar ponteiro: No nodes to query
```

---

## Recomendações Para Você

### Curto Prazo (Diagnóstico)

1. ✅ **Teste Cenário 1** (mesma rede local)
   - Se funcionar: problema confirmado é firewall/rede
   - Se não: problema é LSD/WebTorrent config

2. 📊 **Colete logs:**
   ```bash
   # Log file completo
   cat ~/.coherence-logs/app-*.log
   ```

3. 🔍 **Procure por:**
   - `[torrent] peer adicionado` → Peers foram encontrados
   - `[dht] No nodes to query` → DHT isolado
   - `[discovery] pointer não encontrado` → Follower não achou pointer

### Médio Prazo (Solução Temporária)

- Implement **UI message**: "Modo local-only ativado. Posts visíveis apenas na rede local."
- Mostrar **QR code** com sua chave pública para adicionar manualmente
- Adicionar **botão "Sincronizar Agora"** para forçar poll imediato

### Longo Prazo (Produção)

- Implementar **relay central** (servidor Node.js simples) que armazena pointers
- Ou: Usar **IPFS** (DHT global já embutido)
- Ou: Usar **tracker fallback** central confiável

---

## Próximos Passos

1. **Teste Cenário 1** (mesma rede local)
   - Se funcionar → Mude para usar trackers WSS públicos como fallback
   - Se não funcionar → Problema em WebTorrent/LSD (mais profundo)

2. **Se Cenário 1 funcionar:**
   - Ativar logging de `[torrent] peer` para ver se LSD descobre peers
   - Verificar se pointers chegam via DHT (sim=OK, não=firewall)

3. **Relatear resultados com logs** e podemos refinar a solução

---

## Links Úteis

- [WebTorrent LSD (Local Service Discovery)](https://github.com/webtorrent/webtorrent/blob/master/docs/api.md#lsd)
- [BEP44 Mutable Items](http://bittorrent.org/beps/bep_0044.html)
- [Trackers WSS](https://github.com/webtorrent/webtorrent/blob/master/test/trackers.js)
- [NetStat (verificar portas abertas)](https://docs.microsoft.com/pt-br/windows-server/administration/windows-commands/netstat)

---

**Status Atual:** App operando em **modo local-only** com LSD/PEX habilitados. Pronto para teste.
