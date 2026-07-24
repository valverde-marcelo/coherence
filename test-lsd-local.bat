@echo off
setlocal enabledelayedexpansion

REM Teste de LSD (Local Service Discovery) com 2 instâncias
REM Cada instância tem seus próprios dados em diretório separado
REM LSD descobre chapters automaticamente mesmo sem DHT

echo [LAUNCHER] Teste de LSD Local Discovery
echo [LAUNCHER] Abrindo 2 instâncias com dados separados...
echo.

REM Cria diretórios de teste
set USER1_DATA=%TEMP%\coherence-test\user1
set USER2_DATA=%TEMP%\coherence-test\user2

echo [LAUNCHER] User1 data: %USER1_DATA%
echo [LAUNCHER] User2 data: %USER2_DATA%
echo.

REM Limpa diretórios anteriores (começa limpo)
if exist "%USER1_DATA%" rmdir /s /q "%USER1_DATA%"
if exist "%USER2_DATA%" rmdir /s /q "%USER2_DATA%"

REM Instância 1
echo [LAUNCHER] Abrindo Instância 1...
start "Coherence - User1" cmd /k "cd /d "%cd%" && set COHERENCE_USER_DATA=%USER1_DATA% && npm start"

REM Aguarda um pouco antes de abrir a segunda
timeout /t 3 /nobreak

REM Instância 2
echo [LAUNCHER] Abrindo Instância 2...
start "Coherence - User2" cmd /k "cd /d "%cd%" && set COHERENCE_USER_DATA=%USER2_DATA% && npm start"

echo.
echo [LAUNCHER] Ambas instâncias iniciadas!
echo [LAUNCHER]
echo [LAUNCHER] Instruções:
echo [LAUNCHER]   1. Deixe rodando por ~10 segundos para iniciar
echo [LAUNCHER]   2. Em cada janela, crie um post
echo [LAUNCHER]   3. Verifique se sincronizam automaticamente via LSD
echo [LAUNCHER]   4. Procure nos logs por "[torrent]" e "[discovery]"
echo [LAUNCHER]
echo [LAUNCHER] LSD funciona na mesma rede local (subnet)
echo [LAUNCHER] Feche as janelas para parar as instâncias
echo.
