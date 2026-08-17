# Guia de Releases — Coherence

> Roteiro de como funcionam os lançamentos de versão e a geração automática dos
> executáveis Windows. Consulte este arquivo sempre que for publicar uma versão
> nova ou corrigir algo nas versões já lançadas.

## Contexto atual

| Branch | Papel | Estado |
|--------|-------|--------|
| `main` | Releases **estáveis** | `v1.0.0` e `v1.0.1` publicadas |
| `v2` | Desenvolvimento da próxima versão | Cria para melhorias (sem pasta própria) |

- Pastas no repositório: `v0/` (protótipo) e `v1/` (app atual).
- A versão é definida pelo campo `version` do `v1/package.json` + pela **tag git**;
  a pasta `v1/` é apenas um rótulo de diretório.
- Dados dos usuários (`~/Documents/coherence-data`) **não mudam** com a versão.

---

## 1. A geração de executáveis é automática?

**Sim, mas somente quando você publica uma tag de versão (`v*`).**

O workflow `.github/workflows/release.yml` dispara apenas em `push` de tags como
`v1.0.2`, `v2.0.0`, etc. Ao publicar a tag, ele roda **automaticamente**:

1. Instala dependências (`npm ci`)
2. Roda os testes (`npm test`)
3. Gera o ícone do app
4. Builda `Coherence-Setup-<versão>.exe` (NSIS) + `Coherence-Portable-<versão>.exe`
5. Cria a **GitHub Release** com os dois executáveis anexados

Você não precisa rodar nada localmente — basta subir a tag.

---

## 2. O que acontece com `commit → push` no `main`?

- ❌ **Não** gera executáveis e **não** cria release (o workflow só reage a tags).
- ✅ O **GitHub Pages** reconstrói automaticamente a landing page (`docs/`).
- ✅ O código fica atualizado no repositório.
- ⚠️ Os **usuários não são avisados** — o app só detecta atualização quando existe
  uma **nova release** (ele consulta `releases/latest`).

> Resumo: **push no `main` = atualiza código/página; push de tag = lança versão
> nova com executáveis.**

---

## 3. Como lançar uma nova versão (passo a passo)

```bash
cd v1

# 1) Implemente as alterações no código...

# 2) IMPORTANTE: suba a versão no package.json (ex.: 1.0.1 -> 1.0.2)
#    Senão o .exe gerado teria nome/versão antiga, divergindo da tag.

# 3) Commita e publica o main
git add -A
git commit -m "fix: ..."
git push origin main

# 4) Publica a tag -> CI builda e cria a release automaticamente
git tag v1.0.2
git push origin v1.0.2
```

Pronto: a release aparece no GitHub com os executáveis, e os usuários recebem o
aviso de atualização no app (banner no startup / botão em Configurações).

---

## 4. Modificações ainda na versão 1.0 (patch → v1.0.2)

Enquanto a branch `v2` ainda estiver **igual** ao `main` (ou seja, antes de as
features da v2 serem mergeadas), correções podem ir **direto no `main`**:

```bash
cd v1
# 1) faça a alteração
# 2) suba a versão no package.json (1.0.1 -> 1.0.2)
# 3) commit + push no main
git add -A && git commit -m "fix: ..." && git push origin main
# 4) tag -> release automática
git tag v1.0.2 && git push origin v1.0.2
```

### Quando a v2 avançar (hotfixes da série 1.0)

Quando as features da v2 forem mergeadas no `main` (versão 2.0.0), o `main`
deixa de ser "1.x". Para continuar fazendo **hotfixes da 1.0.x**, crie uma
**branch de manutenção** a partir da última tag 1.x:

```bash
git checkout -b 1.x v1.0.1   # branch de manutenção da série 1.0
git push origin 1.x
# fix na branch 1.x -> bump 1.0.2 -> tag v1.0.2 -> push da tag
```

> Hoje isso **não é necessário** — a v2 ainda não divergiu.

---

## 5. Tabela resumo

| Ação | Gera executável? | Avisa usuários? |
|------|------------------|-----------------|
| `push` no `main` | ❌ | ❌ (só atualiza código/página) |
| `push` de tag `v1.0.2` | ✅ automático | ✅ |
| Trabalhar na branch `v2` | ❌ (até virar release) | ❌ |

---

## 6. Armadilhas e dicas

- **Sempre** bumpa o `version` no `v1/package.json` antes de criar a tag — a tag
  e o `.exe` precisam ter a mesma versão.
- Não edite a tag já publicada para "corrigir" uma release; suba uma versão nova
  (`v1.0.3`, etc.) — o app detecta a mais recente.
- O workflow só dispara para tags `v*`; uma tag como `teste` não gera release.
- Acompanhe o resultado em **Actions** (`https://github.com/valverde-marcelo/coherence/actions`)
  e veja as releases em **Releases** (`.../releases`).

---

## 7. Links úteis

- Releases: https://github.com/valverde-marcelo/coherence/releases
- Actions: https://github.com/valverde-marcelo/coherence/actions
- Landing page: https://valverde-marcelo.github.io/coherence/
- Workflow de release: `.github/workflows/release.yml`
- Config de build (electron-builder): `v1/package.json` → campo `build`
