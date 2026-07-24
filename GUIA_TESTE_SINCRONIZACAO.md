# 📋 Guia Prático: Testando Sincronização de Posts

## Status Atual

✅ **App #1 rodando** com logging diagnóstico ativado  
📊 **Logs salvos em:** `C:\Users\valve\.coherence-logs\app-*.log`

---

## 🎯 Teste 1: Mesma Rede Local (Recomendado Primeiro)

### Setup

**Pré-requisito:** Ambos computadores devem estar no **mesmo Wi-Fi ou LAN**

**Ambiente:**
- Computer A: Rodando app (você está vendo a interface)
- Computer B: Segundo computador na mesma rede

### Passo 1: Copie sua chave pública (Computer A)

1. Abra a app no seu computador
2. Vá em **"Perfil"** (ou tela inicial)
3. **Copie** sua chave pública (será exibida ou mostrada no console)
4. Anote: `<CHAVE_A>`

### Passo 2: Inicie a app no Computer B

```bash
# No Computer B, em outro terminal:
cd c:\Users\valve\Documents\repositorios\redesocial
npm start
```

### Passo 3: User A publica um post

**No Computer A (app rodando):**

1. Clique em **"Escrever novo post"**
2. Digite: `Teste de sincronização entre redes - hora: $(date +%H:%M:%S)`
3. Clique em **"Publicar"**
4. **Observar no console/logs:**
   ```
   [chapters] post adicionado: 1/10 no capítulo aberto
   [chapters] débounce acionado: selar em 15000ms
   (esperar ~15 segundos)
   [chapters] selando capítulo: posts 0-0 (1 posts)
   [chapters] capítulo 0-0 selado completamente em XXXms com infohash...
   [app] ponteiro publicado com sucesso no DHT
   ```

### Passo 4: User B adiciona User A como follow

**No Computer B (app rodando):**

1. Clique em **"Buscar Usuário"** ou **"Adicionar Follow"**
2. Cole a chave pública `<CHAVE_A>`
3. Clique em **"Seguir"** ou **"Adicionar"**
4. **Observar no console/logs:**
   ```
   [app] iniciando poll de 1 follows
   [discovery] poll iniciado para follow <CHAVE_A>
   [dht] resolvendo pointer para <CHAVE_A>...
   ```

### Resultado Esperado ✅

**Sucesso Local (Mesma Rede):**
```
[dht] pointer resolvido com sucesso em XXXms
[torrent] peer adicionado a <infohash>: total agora = 1
[discovery] capítulo 0-0 verificado: 1 posts, ingesting...
[discovery] poll de <CHAVE_A> concluído com sucesso
[app] follow <CHAVE_A> atualizado com posts
```

**Feed em User B deve mostrar o post!**

### Resultado Esperado ❌

**Se Falhar:**

```
[app] DHT bootstrap timeout após 30005ms com 0 peers
[dht] pointer não encontrado no DHT em 11107ms
[discovery] pointer não encontrado para <CHAVE_A>
```

**Significa:** DHT isolado (firewall). Veja **Teste 2** abaixo.

---

## 🎯 Teste 2: Diagnóstico de DHT Isolado

Se Teste 1 falhar com "DHT isolado", execute:

### Verificar Se Está Realmente Isolado

```bash
# No terminal, verificar portas abertas
netstat -an | findstr :6881

# Se nenhum resultado aparecer: UDP 6881 bloqueado (esperado no firewall)
```

### Verificar Trackers Alternativos

Se está totalmente isolado, ainda há opções:

**Opção 1: LSD (Local Service Discovery)**
- Funciona na mesma rede local
- Teste 1 deveria usar LSD via WiFi

**Opção 2: Trackers WSS (já configurados)**
```bash
# Verificar no código:
grep -r "tracker.btorrent" src/

# Resultado esperado:
# 'wss://tracker.btorrent.xyz'
# 'wss://tracker.openwebtorrent.com'
```

**Opção 3: Relay Central (não implementado ainda)**
- Servidor central que armazena pointers
- Necessário para redes separadas sem DHT público

---

## 📊 Coletando Logs Para Análise

### Arquivo de Log Completo

```bash
# Encontrar o arquivo mais recente:
Get-ChildItem C:\Users\valve\.coherence-logs\ -Filter "app-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

# Salvar para análise:
Get-Content "C:\Users\valve\.coherence-logs\app-<timestamp>.log" > logs-teste.txt
```

### Logs Críticos a Procurar

**Sucesso Total:**
- ✅ `[app] DHT pronto: 3+ peers descobertos`
- ✅ `[dht] tentativa 1/7 de publicar ponteiro: SUCESSO`
- ✅ `[torrent] peer adicionado`
- ✅ `[discovery] posts ingeridos`

**Falha DHT:**
- ❌ `[app] DHT ISOLADO: nenhum peer descoberto`
- ❌ `[dht] No nodes to query`
- ❌ `[dht] pointer não encontrado no DHT`

**Falha WebTorrent:**
- ❌ `[discovery] capítulo não encontrado`
- ❌ `[discovery] chapterHash não confere`

---

## 🎮 Casos de Teste Adicionais

### Caso: Múltiplos Posts Rápidos

**User A:**
1. Publica post 1
2. **Imediatamente** publica post 2
3. **Imediatamente** publica post 3

**Esperado:**
```
[chapters] post adicionado: 1/10
[chapters] post adicionado: 2/10
[chapters] post adicionado: 3/10
[chapters] atingiu limite... (se 10) OU
[chapters] capítulo 0-2 selado completamente...
```

**User B observa:**
- Todos 3 posts chegam juntos em 1 capítulo ✅

### Caso: App Reinicializada Mid-Seal

**User A:**
1. Publica 1 post
2. **Imediatamente feche o app** (antes de 15s de débounce)
3. Reabra app

**Esperado:**
```
[chapters] recuperando capítulo aberto com 1 posts pendentes, selando...
[chapters] capítulo 0-0 selado completamente...
[app] ponteiro publicado com sucesso...
```

---

## 📝 Checklist de Teste

- [ ] Teste 1a: Publicar post em User A
- [ ] Teste 1b: Adicionar User A em User B
- [ ] Teste 1c: Post aparece em User B
- [ ] Teste 2a: Verificar DHT status
- [ ] Teste 2b: Coletar logs
- [ ] Teste 3a: Múltiplos posts
- [ ] Teste 3b: App crash recovery

---

## 🚀 Próximas Etapas Após Testes

**Se Teste 1 Suceder:**
- ✅ LSD/WebTorrent funcionam perfeitamente
- ✅ Problema é apenas DHT isolado (firewall)
- ⏭️ Implementar fallback de trackers
- ⏭️ Implementar UI de status

**Se Teste 1 Falhar:**
- ❌ Problema em LSD ou WebTorrent (mais raro)
- ⏭️ Debug profundo de WebTorrent
- ⏭️ Verificar se seed/download básico funciona

---

## 💡 Dicas de Debug

### Ver Todos os Logs em Tempo Real

```bash
# Terminal 1: App rodando
npm start

# Terminal 2: Monitorar logs
Get-Content C:\Users\valve\.coherence-logs\app-*.log -Wait -Tail 50
```

### Forçar Sync Manual (quando implementado)

```
Em desenvolvimento:
- Botão "Sincronizar Agora"
- Force seal do capítulo aberto
- Force poll imediato
```

### Limpar Cache Entre Testes

```bash
# Se precisar resetar:
rm -r ~/.coherence-*
npm start
```

---

**Boa sorte com os testes! 🎉**

Report dos resultados no documento `test-results.md` após completar.
