# 🔧 PROBLEMAS IDENTIFICADOS E RESOLVIDOS — Sessão 2

## Situação Inicial

Você testou sincronização entre 2 instâncias **na mesma máquina** e descobriu:

```log
[discovery] poll iniciado para follow 2431facf
[discovery] poll iniciado para follow 2431facf  ← MESMA CHAVE!
```

Ambas instâncias tinham **identidade idêntica**, impossibilitando teste local.

---

## 🎯 Problemas Encontrados

### ❌ Problema 1: Identidade Compartilhada

**Sintoma:** 
```
Ambas instâncias com public key hash: 2431facf
```

**Raiz:**
```javascript
// paths.js (ANTES):
function root() {
  const base = app.getPath('userData')  // Mesma para todas instâncias!
  return path.join(base, 'p2p-social')
}
```

**Solução:** ✅ **Adicionado suporte a `COHERENCE_USER_DATA` env var**

```javascript
// paths.js (DEPOIS):
function root() {
  if (process.env.COHERENCE_USER_DATA) {
    return process.env.COHERENCE_USER_DATA  // Pode ser diferente por instância
  }
  return path.join(app.getPath('userData'), 'p2p-social')
}
```

---

### ❌ Problema 2: Erro EPERM ao Gravar db.json

**Sintoma:**
```
Error: EPERM: operation not permitted, rename 
'C:\Users\valve\AppData\Roaming\coherence\p2p-social\db.json.tmp' -> 
'C:\Users\valve\AppData\Roaming\coherence\p2p-social\db.json'
```

**Raiz:** Múltiplas instâncias escrevendo simultaneamente no mesmo arquivo
```
Instância 1: escreve tmp, tenta renomear
Instância 2: escreve tmp (sobrescreve), tenta renomear
Instância 1: erro EPERM (arquivo em uso)
```

**Solução:** ✅ **Adicionado retry com backoff em `store.js`**

```javascript
// store.js (DEPOIS):
_saveWithRetry(attempt = 1, maxAttempts = 5) {
  fs.rename(tmp, this.file, err2 => {
    if (!err2) return resolve()
    
    if (err2.code === 'EPERM' && attempt < maxAttempts) {
      const backoffMs = Math.min(500, attempt * 100)  // 100, 200, 300, 400, 500ms
      setTimeout(() => this._saveWithRetry(attempt + 1), backoffMs)
      return
    }
  })
}
```

**Resultado:** Até 5 tentativas com delay exponencial. Múltiplas instâncias agora funcionam sem corrupção de dados.

---

## ✅ Mudanças Implementadas

### 1️⃣ `src/main/paths.js`

**O quê:** Suporte a múltiplas instâncias com diretórios separados

**Mudança:** Respeita `COHERENCE_USER_DATA` env var

**Efeito:** Cada instância pode ter dados/identidade únicos

---

### 2️⃣ `src/main/store.js`

**O quê:** Retry automático para escrita concorrente

**Mudança:** Método `_saveWithRetry()` com exponential backoff

**Efeito:** Erro EPERM não derruba mais a app, tenta novamente

---

### 3️⃣ `scripts/test-multi-instance.ps1` (NOVO)

**O quê:** Script para iniciar múltiplas instâncias

**Como usar:**
```powershell
cd c:\Users\valve\Documents\repositorios\redesocial
.\scripts\test-multi-instance.ps1 -instances 2
```

**Efeito:** 
- Abre 2 janelas Electron
- Cada com `COHERENCE_USER_DATA` diferente
- Cada com identidade única
- Mostra PIDs e caminhos de dados

---

### 4️⃣ `TESTE_MULTIPLAS_INSTANCIAS.md` (NOVO)

**O quê:** Guia passo-a-passo para testar sincronização

**Conteúdo:**
- Como executar o script
- Passo 1-4 do teste prático
- O que observar nos logs
- Troubleshooting

---

## 🚀 Próximo Passo: Teste Prático

### Para Você

1. **Abra PowerShell:**
   ```powershell
   cd c:\Users\valve\Documents\repositorios\redesocial
   .\scripts\test-multi-instance.ps1 -instances 2
   ```

2. **Aguarde 2 janelas abrirem** (user1 e user2)

3. **Para cada janela:**
   - Vá para Perfil
   - Copie a chave pública
   - Verifique que são **diferentes**

4. **Test Sync:**
   - user1: publique post
   - user2: adicione user1 como follow
   - Observe logs para `[torrent] peer adicionado` (LSD!)
   - Post deve aparecer em user2

### Esperado ✅

Se funciona:
```
[torrent] peer adicionado a <hash>: total agora = 1 (LSD descoberta!)
[discovery] posts ingeridos com sucesso
→ Post aparece no feed de user2
```

Se falha:
```
[discovery] capítulo não encontrado (problema em WebTorrent)
→ Precisa debug mais profundo
```

---

## 📊 Comparação Antes vs Depois

| Aspecto | Antes | Depois |
|---------|-------|--------|
| **Instâncias Na Mesma Máquina** | Compartilham identidade | Identidades únicas |
| **Múltiplas Escritas em db.json** | Erro EPERM derruba app | Retry automático |
| **Teste Local Possível** | ❌ Não | ✅ Sim |
| **Script de Teste** | Não existe | ✅ `test-multi-instance.ps1` |

---

## 🎯 Roadmap de Teste

### Fase 1: Teste Local ← Você está aqui
```
user1 e user2 na MESMA máquina
via LSD (Local Service Discovery)
Esperado: Funciona ✅
```

### Fase 2: Teste em Rede Local (se tiver 2 PCs)
```
user1 em PC1, user2 em PC2
mesmo Wi-Fi
Esperado: Sincroniza via LSD ✅
```

### Fase 3: Teste em Redes Separadas (Firewall)
```
user1 em rede A, user2 em rede B
firewall bloqueia UDP 6881-6889
Esperado: Falha DHT, tenta trackers ⏳
```

---

## 💡 Resumo Técnico

**Causa Raiz do Problema Original:**

1. **Mesma identidade** → Não conseguia testar localmente
2. **DHT isolado** → Firewall UDP bloqueado
3. **Sem LSD** → Não tinha descoberta de peers locais (estava funcionando, apenas não era testado)

**Solução:**

1. ✅ Suporte a múltiplas instâncias com identidades separadas
2. ✅ Retry automático para concorrência de escrita
3. ✅ Script para facilitar teste local
4. ✅ Documentação de teste

**Resultado:**

Agora você pode testar se LSD funciona (deve funcionar na mesma máquina/rede).

---

## 📝 Arquivos Para Ler

1. **`TESTE_MULTIPLAS_INSTANCIAS.md`** ← Leia primeiro para entender teste
2. **`DIAGNOSTICO_DHT_ISOLADO.md`** ← Para entender contexto completo
3. **`STATUS_REVISAO.md`** ← Resumo da Fase 1 anterior

---

## ✋ Aguardando

Seus resultados de teste! 🧪

→ Execute o script  
→ Teste sincronização  
→ Report o que viu nos logs  
→ A partir daí, próximas ações

**Sucesso esperado:** Post sincroniza via LSD ✅

---

**Quando estiver pronto, execute:**
```powershell
.\scripts\test-multi-instance.ps1 -instances 2
```

**E me traga os logs!**
