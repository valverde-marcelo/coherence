#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Testa LSD (Local Service Discovery) com 2 instâncias
.DESCRIPTION
  Abre 2 janelas do Electron com dados separados para testar
  sincronização automática via LSD (mDNS) na mesma rede local.
.EXAMPLE
  .\test-lsd-local.ps1
#>

Write-Host "[LAUNCHER] Teste de LSD (Local Service Discovery)" -ForegroundColor Cyan
Write-Host "[LAUNCHER] Abrindo 2 instâncias com dados separados..." -ForegroundColor Green
Write-Host ""

# Caminhos de dados
$user1Data = "$env:TEMP\coherence-test\user1"
$user2Data = "$env:TEMP\coherence-test\user2"

Write-Host "[LAUNCHER] User1 data: $user1Data" -ForegroundColor Gray
Write-Host "[LAUNCHER] User2 data: $user2Data" -ForegroundColor Gray
Write-Host ""

# Limpa diretórios anteriores
if (Test-Path $user1Data) { Remove-Item -Recurse -Force $user1Data -ErrorAction Ignore }
if (Test-Path $user2Data) { Remove-Item -Recurse -Force $user2Data -ErrorAction Ignore }

# Instância 1
Write-Host "[LAUNCHER] Abrindo Instância 1..." -ForegroundColor Yellow
$proc1 = Start-Process -PassThru -NoNewWindow pwsh -ArgumentList @(
  '-NoProfile'
  '-Command'
  @"
    `$env:COHERENCE_USER_DATA = '$user1Data'
    cd '{0}'
    npm start
"@ -f (Get-Location)
)

# Aguarda um pouco
Start-Sleep -Seconds 3

# Instância 2
Write-Host "[LAUNCHER] Abrindo Instância 2..." -ForegroundColor Yellow
$proc2 = Start-Process -PassThru -NoNewWindow pwsh -ArgumentList @(
  '-NoProfile'
  '-Command'
  @"
    `$env:COHERENCE_USER_DATA = '$user2Data'
    cd '{0}'
    npm start
"@ -f (Get-Location)
)

Write-Host ""
Write-Host "[LAUNCHER] Ambas instâncias iniciadas!" -ForegroundColor Green
Write-Host "[LAUNCHER]" -ForegroundColor Cyan
Write-Host "[LAUNCHER] Instruções:" -ForegroundColor White
Write-Host "  1. Deixe rodando por ~10 segundos para iniciar" -ForegroundColor Gray
Write-Host "  2. Em cada janela, crie um post" -ForegroundColor Gray
Write-Host "  3. Verifique se sincronizam automaticamente via LSD" -ForegroundColor Gray
Write-Host "  4. Procure nos logs por '[torrent]' e '[discovery]'" -ForegroundColor Gray
Write-Host ""
Write-Host "[LAUNCHER] LSD funciona na mesma rede local (subnet)" -ForegroundColor Cyan
Write-Host "[LAUNCHER] Presione Ctrl+C para parar" -ForegroundColor Yellow
Write-Host ""

# Aguarda indefinidamente
try {
  while ($true) {
    Start-Sleep -Seconds 5
    if ($proc1.HasExited -or $proc2.HasExited) {
      Write-Host "[LAUNCHER] Uma ou mais instâncias encerraram" -ForegroundColor Yellow
      break
    }
  }
} finally {
  Write-Host "[LAUNCHER] Encerrando..." -ForegroundColor Yellow
  Stop-Process -Id $proc1.Id -ErrorAction Ignore
  Stop-Process -Id $proc2.Id -ErrorAction Ignore
}
