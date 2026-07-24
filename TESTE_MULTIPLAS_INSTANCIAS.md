# 🧪 TESTE DE MÚLTIPLAS INSTÂNCIAS - Guia Rápido

## Problema Resolvido ✅

Você identificou corretamente: ambas as instâncias na mesma máquina compartilhavam a mesma identidade.

**Solução implementada:**
- ✅ `paths.js` — Suporta `COHERENCE_USER_DATA` env var para separar dados por instância
- ✅ `store.js` — Melhorado para lidar com múltiplas instâncias escrevendo simultaneamente
- ✅ `scripts/test-multi-instance.ps1` — Script para iniciar 2+ instâncias com identidades diferentes

---

## 🚀 Como Executar o Teste

### Pré-requisito: Feche todas as instâncias antigas

```powershell
# No PowerShell:
Get-Process -Name electron | Stop-Process -Force
```

### Execute o Script de Teste

```powershell
cd c:\Users\valve\Documents\repositorios\redesocial
.\scripts\test-multi-instance.ps1 -instances 2
```

**O que acontece:**
1. ✅ Abre **2 janelas do Electron** separadas
2. ✅ Cada uma com **identidade única** (chave pública diferente)
3. ✅ Dados em diretórios diferentes:
   - `C:\Users\temp\coherence-test\user1\`
   - `C:\Users\temp\coherence-test\user2\`
4. ✅ Ambas as janelas mostram logs em tempo real

---

## 🎯 Teste Prático: Sincronização via LSD

### Passo 1: Copiar Chaves Públicas

Em **cada janela**, vá para **Perfil**:
- Copie a chave pública (ex: `2431facf...`)
- Anote qual é de user1 e qual é de user2

### Passo 2: User1 Publica um Post

Na **janela user1**:
1. Clique em **"Novo Post"**
2. Digite: `Teste sincronização user1 via LSD - $(Get-Date -Format HH:mm:ss)`
3. Clique em **"Publicar"**
4. **Observe no console:**
   ```
   [chapters] post adicionado: 1/10 no capítulo aberto
   [chapters] débounce: selar em 15000ms
   (aguarde ~15s)
   [chapters] capítulo 0-0 selado completamente em XXXms
   [torrent] novo torrent: HASH... seeding...
   ```

### Passo 3: User2 Adiciona User1 como Follow

Na **janela user2**:
1. Clique em **"Buscar Usuário"** ou **"Adicionar Follow"**
2. Cole a chave pública de **user1**
3. Clique em **"Seguir"** ou **"Adicionar"**
4. **Observe no console de user2:**
   ```
   [app] iniciando poll de 1 follows
   [discovery] poll iniciado para follow <CHAVE_USER1>
   [dht] resolvendo pointer...
   
   (esperado: falha DHT, mas depois LSD descoberta!)
   
   [torrent] peer adicionado a <infohash>: via LSD (descoberta local!)
   [discovery] capítulo baixando 1/1...
   [discovery] posts ingeridos com sucesso
   ```

### Passo 4: Verificar Sincronização ✅

**User2 agora deve ver o post de User1 no feed!**

---

## 📊 O Que Observar nos Logs

### Sucesso Local (LSD) ✅

```
[torrent] peer adicionado a <infohash>: total agora = 1 (LSD descoberta!)
[discovery] capítulo 0-0 verificado: 1 posts
[discovery] posts ingeridos com sucesso
```

→ Post aparece no feed de User2

### Falha DHT (Esperado) ⚠️

```
[dht] pointer não encontrado no DHT em 11093ms (esperado em cold-start)
```

→ Isso é NORMAL (DHT isolado por firewall)

### Falha LSD (Problema) ❌

```
[discovery] capítulo não encontrado no torrent
[torrent] nenhum peer encontrado após 30s
```

→ Se isso aparecer, há problema em WebTorrent/LSD

---

## 🔍 Monitorar Logs em Tempo Real

Abra **novo terminal** PowerShell:

```powershell
Get-Content C:\Users\valve\.coherence-logs\app-*.log -Wait -Tail 50
```

Isso mostra todos os logs das 2 instâncias em tempo real.

---

## 📋 Checklist de Teste

Faça check conforme avança:

- [ ] Script iniciou 2 janelas com PIDs diferentes
- [ ] Cada janela mostra chave pública DIFERENTE no perfil
- [ ] User1 publicou post (confirmado no console)
- [ ] User2 adicionou user1 como follow
- [ ] Console de User2 mostra `[torrent] peer adicionado`
- [ ] Post de User1 aparece no feed de User2
- [ ] Inverter: User2 publica, User1 recebe
- [ ] Publicar múltiplos posts, todos sincronizam

---

## 🚨 Se Algo Der Errado

### "Erro EPERM" nos logs

**Possível causa:** Ambas instâncias escrevendo no mesmo db.json  
**Verificar:** Che carse `COHERENCE_USER_DATA` está sendo usado  
**Solução:** Parar tudo, executar script novamente

```powershell
Get-Process -Name electron | Stop-Process -Force
Start-Sleep -Seconds 2
.\scripts\test-multi-instance.ps1 -instances 2
```

### "Mesma chave pública em ambas"

**Significa:** Variável de ambiente não foi passada  
**Verificar:** No console da app procure por:
```
[app] COHERENCE_USER_DATA= <deve mostrar o caminho>
```

Se não aparecer, o script não passou corretamente.

### "Post não sincroniza"

**Passos de debug:**
1. Verificar se está vendo logs de LSD:
   ```
   [torrent] peer adicionado via udp
   ```
2. Se não vê isso, WebTorrent não descobriu o peer
3. Se vê, mas post não aparece, problema em download/ingestão

---

## 💾 Backup dos Dados de Teste

Se quiser rerunner o teste depois:

```powershell
# Seus dados de teste estão em:
dir C:\Users\temp\coherence-test\

# Backup:
Copy-Item C:\Users\temp\coherence-test\ -Destination C:\Users\temp\coherence-test-backup\ -Recurse

# Limpar tudo:
Remove-Item C:\Users\temp\coherence-test\ -Recurse -Force
```

---

## ✅ Próximas Etapas

**Depois de confirmar funciona via LSD:**

1. Implementar relay central para redes separadas
2. Melhorar UI/UX para indicar modo local-only
3. Adicionar botão "Sincronizar Agora"
4. Dashboard de status DHT/LSD/PEX

**Se não funciona via LSD:**

1. Debug profundo de WebTorrent
2. Verificar se `lsd: true` está ativado
3. Testar seeding/download de torrent isolado

---

## 🎬 Resumo dos Comandos

```powershell
# Terminal 1: Executar teste
cd c:\Users\valve\Documents\repositorios\redesocial
.\scripts\test-multi-instance.ps1 -instances 2

# Terminal 2: Monitorar logs
Get-Content C:\Users\valve\.coherence-logs\app-*.log -Wait -Tail 50

# Terminal 3: Parar tudo se necessário
Get-Process -Name electron | Stop-Process -Force
```

---

**Bom teste! 🎉**

Report seus resultados e vamos debugar juntos se necessário.
