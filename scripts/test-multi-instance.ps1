# Script para Testar Multiplas Instancias com Identidades Separadas
# Uso: .\scripts\test-multi-instance.ps1 -instances 2

param(
    [int]$instances = 2,
    [int]$delaySeconds = 3
)

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

Write-Host ""
Write-Host "[LAUNCHER] Iniciando $instances instancias da app com identidades separadas..." -ForegroundColor Cyan
Write-Host ""

# Array para guardar process IDs
$pids = @()
$tempBaseDir = Join-Path $env:TEMP "coherence-test"

# Limpar old instances se houver
Write-Host "[LAUNCHER] Limpando instancias antigas..." -ForegroundColor Gray
Get-Process -Name "electron" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*coherence-test*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Criar diretorio base
if (-not (Test-Path $tempBaseDir)) {
    New-Item -ItemType Directory -Path $tempBaseDir -Force | Out-Null
}

for ($i = 1; $i -le $instances; $i++) {
    $instanceName = "user$i"
    $userDataPath = Join-Path $tempBaseDir $instanceName
    
    Write-Host ""
    Write-Host "[LAUNCHER] Iniciando Instancia $i`: $instanceName" -ForegroundColor Yellow
    Write-Host "   Dados em: $userDataPath" -ForegroundColor Gray
    Write-Host "   Esta instancia tera identidade UNICA" -ForegroundColor Cyan
    
    # Criar diretorio se nao existir
    if (Test-Path $userDataPath) {
        Write-Host "   Removendo dados antigos..." -ForegroundColor Gray
        Remove-Item $userDataPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $userDataPath -Force | Out-Null
    
    # Start new process in a separate PowerShell window
    $cmdLine = "Set-Location '$projectRoot'; `$env:COHERENCE_USER_DATA='$userDataPath'; npm start"
    
    $process = Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoExit", "-Command", $cmdLine) `
        -PassThru
    
    $pids += @{
        Id = $process.Id
        Name = $instanceName
        DataPath = $userDataPath
    }
    
    Write-Host "   OK - PID: $($process.Id)" -ForegroundColor Green
    
    # Aguardar entre inicializacoes
    if ($i -lt $instances) {
        Write-Host "   Aguardando $delaySeconds segundos..." -ForegroundColor Gray
        Start-Sleep -Seconds $delaySeconds
    }
}

Write-Host ""
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "TODAS AS INSTANCIAS INICIADAS COM IDENTIDADES SEPARADAS!" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host ""

Write-Host "[LAUNCHER] Instancias em execucao:" -ForegroundColor Yellow
$pids | ForEach-Object {
    Write-Host "   $($_.Name) (PID $($_.Id))" -ForegroundColor Green
    Write-Host "      Dados: $($_.DataPath)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[LAUNCHER] TESTE LOCALIZADO DE SINCRONIZACAO:" -ForegroundColor Cyan
Write-Host ""
Write-Host "   Passo 1: Em CADA janela, va para Perfil e COPIE a chave publica" -ForegroundColor White
Write-Host ""
Write-Host "   Passo 2: Em user1, publique um post" -ForegroundColor White
Write-Host ""
Write-Host "   Passo 3: Em user2, va para Buscar Usuario e cole a chave de user1" -ForegroundColor White
Write-Host ""
Write-Host "   Passo 4: OBSERVAR NOS LOGS:" -ForegroundColor Yellow
Write-Host "           [torrent] peer adicionado via udp (LSD descoberta!)" -ForegroundColor Green
Write-Host "           [discovery] posts ingeridos (sincronizacao sucesso!)" -ForegroundColor Green
Write-Host "           Post aparece no feed de user2" -ForegroundColor Green
Write-Host ""

Write-Host "[LAUNCHER] MONITORAR LOGS EM TEMPO REAL (abra novo terminal):" -ForegroundColor Cyan
Write-Host "   Get-Content C:\Users\valve\.coherence-logs\app-*.log -Wait -Tail 30" -ForegroundColor Gray
Write-Host ""

Write-Host "[LAUNCHER] VERIFICAR DADOS DE CADA INSTANCIA:" -ForegroundColor Cyan
$user1Path = Join-Path $tempBaseDir 'user1'
$user2Path = Join-Path $tempBaseDir 'user2'
Write-Host "   user1: $user1Path" -ForegroundColor Gray
Write-Host "   user2: $user2Path" -ForegroundColor Gray
Write-Host ""

Write-Host "[LAUNCHER] PARA FECHAR TUDO:" -ForegroundColor Cyan
Write-Host "   Get-Process -Name electron | Stop-Process -Force" -ForegroundColor Gray
Write-Host ""

Write-Host "[LAUNCHER] LOGS SERAO SALVOS EM:" -ForegroundColor Cyan
Write-Host "   C:\Users\valve\.coherence-logs\app-*.log" -ForegroundColor Gray
Write-Host ""

Pop-Location

# Aguardar usuario
Write-Host "[LAUNCHER] Pressione Enter para continuar monitorando..." -ForegroundColor Yellow
Read-Host

# Monitorar status das instancias
Write-Host ""
Write-Host "[LAUNCHER] Status das Instancias (atualizado a cada 5s):" -ForegroundColor Cyan
while ($true) {
    Clear-Host
    Write-Host "[LAUNCHER] Status das Instancias (atualizado a cada 5s):" -ForegroundColor Cyan
    Write-Host ""
    
    $running = @()
    $pids | ForEach-Object {
        $proc = Get-Process -Id $_.Id -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "   OK $($_.Name) (PID $($_.Id)) - ATIVO" -ForegroundColor Green
            $running += $_
        } else {
            Write-Host "   ENCERRADO $($_.Name) (PID $($_.Id))" -ForegroundColor Red
        }
    }
    
    if ($running.Count -eq 0) {
        Write-Host ""
        Write-Host "[LAUNCHER] Todas as instancias foram fechadas." -ForegroundColor Yellow
        break
    }
    
    Write-Host ""
    Write-Host "[LAUNCHER] Pressione Ctrl+C para encerrar..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
}

