@echo off
title VELVY STUDIO - BOT DISCORD & SERVIDOR DE LICENCAS
color 0b
echo ========================================================
echo       VELVY STUDIO - DISCORD BOT & LICENSING API
echo ========================================================
echo.
cd /d "%~dp0\velvy-discord-bot"

echo [1/3] Liberando porta 7777 de instancias anteriores...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :7777') do (
    taskkill /f /pid %%a >nul 2>&1
)

if not exist node_modules (
    echo [2/3] Instalando dependencias...
    npm install
)

echo [3/3] Iniciando Bot e Servidor de Licencas...
echo.
node index.js
pause
