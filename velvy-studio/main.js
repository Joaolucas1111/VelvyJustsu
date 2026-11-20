const { app, BrowserWindow, ipcMain, dialog, session, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { getMachineHWID, verifyLicenseStatus, activateWithServer } = require('./license-client');
const pkg = require('./package.json');
const { checkForUpdates, downloadUpdate, applyUpdateAndRestart } = require('./updater');

let mainWindow;
let splashWindow = null;
let localHttpServer = null;
const LOCAL_PORT = 7890;
const settingsFile = path.join(app.getPath('userData'), 'velvy_settings.json');

function startDedicatedServer() {
  try {
    localHttpServer = http.createServer((req, res) => {
      let reqPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const safePath = path.normalize(path.join(__dirname, reqPath));

      if (!safePath.startsWith(__dirname)) {
        res.writeHead(403);
        return res.end('Acesso negado');
      }

      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath).toLowerCase();
        const mimeTypes = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'application/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.svg': 'image/svg+xml'
        };
        res.writeHead(200, {
          'Content-Type': mimeTypes[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*'
        });
        return fs.createReadStream(safePath).pipe(res);
      }

      res.writeHead(404);
      res.end('Arquivo nao encontrado no VELVY STUDIO');
    });

    localHttpServer.listen(LOCAL_PORT, '127.0.0.1', () => {
      console.log(`[VELVY STUDIO] Servidor local dedicado ativo em: http://localhost:${LOCAL_PORT}`);
    });

    localHttpServer.on('error', (err) => {
      console.warn(`[VELVY STUDIO] Aviso na porta local ${LOCAL_PORT}:`, err.message);
    });
  } catch (err) {
    console.error('[VELVY STUDIO] Erro ao iniciar servidor dedicado:', err);
  }
}

function loadSettings() {
  const defaultSettings = {
    workflowUrl: 'https://www.runninghub.ai/pt-br/workflow/2123548590904102913',
    apiKey: '',
    gpuTier: 'Lite/Plus', // 'Lite/Standard', 'Lite/Plus', 'Ultra-6000D'
    initDelaySeconds: 270, // 4.5 minutos
    outputDir: path.join(app.getPath('videos'), 'VELVY_OUTPUTS'),
    autoDownload: true,
    headlessRun: false,
    licenseServerUrl: 'http://localhost:7777'
  };

  try {
    if (fs.existsSync(settingsFile)) {
      const data = fs.readFileSync(settingsFile, 'utf-8');
      return { ...defaultSettings, ...jsonParseSafe(data, {}) };
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
  return defaultSettings;
}

function jsonParseSafe(str, fallback) {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Error saving settings:', err);
    return false;
  }
}

function createSplashWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  splashWindow = new BrowserWindow({
    width: 480,
    height: 310,
    frame: false,
    transparent: true,
    center: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile('splash.html');

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow() {
  // Configurar partição persistente para salvar login, cookies e tokens
  const customSession = session.fromPartition('persist:runninghub', { cache: true });

  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false, // Inicia oculto para exibir a tela de carregamento (splash)
    backgroundColor: '#09090b',
    title: 'VELVY STUDIO — Suíte Profissional de IA',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      session: customSession
    }
  });

  mainWindow.loadFile('index.html');

  // Transição suave da tela de carregamento inicial para a aplicação principal
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        // Checagem automática de atualização após 5 segundos da abertura
        setTimeout(() => {
          runAutoUpdateCheck();
        }, 5000);
      }
    }, 1500);
  });

  // Proteção e Segurança do App
  mainWindow.setMenuBarVisibility(false);

  // Bloqueio de atalhos de desenvolvedor (F12, Ctrl+Shift+I, Ctrl+U)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.key === 'F12') || (input.control && input.shift && input.key.toLowerCase() === 'i') || (input.control && input.key.toLowerCase() === 'u')) {
      event.preventDefault();
    }
  });

  // Desativa menu de contexto padrão (Inspecionar Elemento)
  mainWindow.webContents.on('context-menu', (e) => e.preventDefault());

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers de Licença e HWID
ipcMain.handle('license:status', () => {
  return verifyLicenseStatus(app);
});

ipcMain.handle('license:activate', async (event, key) => {
  const settings = loadSettings();
  const serverUrl = settings.licenseServerUrl || 'http://localhost:7777';
  return await activateWithServer(app, key, serverUrl);
});

// IPC Handlers
ipcMain.handle('dialog:openFile', async (event, { type, multiple }) => {
  const filters = type === 'video'
    ? [{ name: 'Vídeos', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }]
    : [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'webp', 'jfif'] }];

  const properties = ['openFile'];
  if (multiple) properties.push('multiSelections');

  const res = await dialog.showOpenDialog(mainWindow, {
    properties,
    filters
  });

  if (!res.canceled && res.filePaths.length > 0) {
    if (multiple) {
      return res.filePaths.map(filePath => ({
        path: filePath,
        name: path.basename(filePath),
        size: fs.statSync(filePath).size
      }));
    }
    const filePath = res.filePaths[0];
    return {
      path: filePath,
      name: path.basename(filePath),
      size: fs.statSync(filePath).size
    };
  }
  return null;
});

ipcMain.handle('dialog:openDirectory', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (!res.canceled && res.filePaths.length > 0) {
    return res.filePaths[0];
  }
  return null;
});

ipcMain.handle('settings:load', () => {
  return loadSettings();
});

ipcMain.handle('settings:save', (event, settings) => {
  return saveSettings(settings);
});

// Desconectar / Limpar Sessão da RunningHub (Troca de Conta)
ipcMain.handle('session:logout', async () => {
  try {
    const customSession = session.fromPartition('persist:runninghub');
    await customSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
    });
    await customSession.clearCache();
    console.log('[VELVY STUDIO] Sessão e cookies da RunningHub limpos com sucesso.');
    return { success: true };
  } catch (err) {
    console.error('[VELVY STUDIO] Erro ao limpar sessão:', err);
    return { success: false, error: err.message };
  }
});

// Leitura de arquivo local para injeção via Webview
ipcMain.handle('file:readBase64', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error('Arquivo não encontrado: ' + filePath);
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    };
    const buffer = fs.readFileSync(filePath);
    return {
      base64: buffer.toString('base64'),
      mimeType: mimeMap[ext] || 'application/octet-stream',
      name: path.basename(filePath),
      size: buffer.length
    };
  } catch (err) {
    console.error('[VELVY STUDIO] Erro ao ler base64:', err);
    throw err;
  }
});

// Download direto e confiável de vídeo final (COS CDN, URL direta, relative ou Base64) para disco local
ipcMain.handle('download:video', async (event, { url, filename, outputDir }) => {
  try {
    const settings = loadSettings();
    const targetDir = outputDir || settings.outputDir || path.join(app.getPath('videos'), 'VELVY_OUTPUTS');

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const cleanFilename = filename.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const destPath = path.join(targetDir, cleanFilename);

    console.log(`[VELVY STUDIO] Salvando vídeo para: ${destPath}`);

    // 1. Caso seja Base64 / Data URL
    if (url.startsWith('data:')) {
      const commaIdx = url.indexOf(',');
      const base64Data = commaIdx !== -1 ? url.substring(commaIdx + 1) : url;
      fs.writeFileSync(destPath, Buffer.from(base64Data, 'base64'));
      console.log(`[VELVY STUDIO] Vídeo base64 salvo com sucesso: ${destPath} (${fs.statSync(destPath).size} bytes)`);
      return { success: true, path: destPath, filename: cleanFilename };
    }

    // 2. Caso seja URL relativa (ex: /view?filename=...)
    let downloadUrl = url;
    if (downloadUrl.startsWith('/')) {
      downloadUrl = 'https://www.runninghub.ai' + downloadUrl;
    }

    // 3. Download nativo via Electron net.request (compartilha sessão, cookies e TLS do Chromium)
    const customSession = session.fromPartition('persist:runninghub');

    let cookieHeader = '';
    try {
      const cookies = await customSession.cookies.get({ url: downloadUrl });
      cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    } catch (e) {}

    return new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(destPath);
      let resolved = false;

      function executeNetRequest(targetUrl, retryCount = 0) {
        try {
          const req = net.request({
            url: targetUrl,
            session: customSession
          });

          req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          req.setHeader('Referer', 'https://www.runninghub.ai/');
          req.setHeader('Accept', '*/*');
          if (cookieHeader) {
            req.setHeader('Cookie', cookieHeader);
          }

          req.on('response', (response) => {
            // Suporte a Redirecionamento 301 / 302
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              let loc = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
              if (loc.startsWith('/')) loc = 'https://www.runninghub.ai' + loc;
              return executeNetRequest(loc, retryCount);
            }

            if (response.statusCode !== 200) {
              fs.unlink(destPath, () => {});
              if (!resolved) {
                resolved = true;
                return reject(new Error(`Falha no download HTTP ${response.statusCode}`));
              }
              return;
            }

            response.on('data', (chunk) => {
              fileStream.write(chunk);
            });

            response.on('end', () => {
              fileStream.end();
            });

            fileStream.on('finish', () => {
              const size = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
              console.log(`[VELVY STUDIO] Arquivo baixado e gravado no disco com sucesso: ${destPath} (${size} bytes)`);
              if (!resolved) {
                resolved = true;
                resolve({ success: true, path: destPath, filename: cleanFilename });
              }
            });

            fileStream.on('error', (err) => {
              fs.unlink(destPath, () => {});
              if (!resolved) {
                resolved = true;
                reject(err);
              }
            });
          });

          req.on('error', (err) => {
            console.warn('[VELVY STUDIO] net.request tentativa', retryCount, 'erro:', err.message);
            if (retryCount < 2) {
              setTimeout(() => executeNetRequest(targetUrl, retryCount + 1), 1500);
              return;
            }

            // Fallback para https padrão com cookies de sessão e headers completos
            console.warn('[VELVY STUDIO] Tentando fallback https nativo com cookies...');
            const client = targetUrl.startsWith('https') ? https : http;
            const reqHeaders = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://www.runninghub.ai/',
              'Accept': '*/*'
            };
            if (cookieHeader) reqHeaders['Cookie'] = cookieHeader;

            const fallbackReq = client.get(targetUrl, { headers: reqHeaders }, (fallbackRes) => {
              if (fallbackRes.statusCode !== 200) {
                fs.unlink(destPath, () => {});
                if (!resolved) {
                  resolved = true;
                  return reject(new Error(`Falha no download fallback HTTP ${fallbackRes.statusCode}`));
                }
                return;
              }
              fallbackRes.pipe(fileStream);
              fileStream.on('finish', () => {
                fileStream.close();
                const size = fs.existsSync(destPath) ? fs.statSync(destPath).size : 0;
                console.log(`[VELVY STUDIO] Vídeo baixado com sucesso via fallback: ${destPath} (${size} bytes)`);
                if (!resolved) {
                  resolved = true;
                  resolve({ success: true, path: destPath, filename: cleanFilename });
                }
              });
            });

            fallbackReq.on('error', (fbErr) => {
              fs.unlink(destPath, () => {});
              if (!resolved) {
                resolved = true;
                reject(fbErr);
              }
            });
          });

          req.end();
        } catch (e) {
          fs.unlink(destPath, () => {});
          if (!resolved) {
            resolved = true;
            reject(e);
          }
        }
      }

      executeNetRequest(downloadUrl);
    });
  } catch (err) {
    console.error('[VELVY STUDIO] Erro no download nativo:', err);
    throw err;
  }
});

// Abrir pasta local no explorador de arquivos
ipcMain.handle('shell:openPath', async (event, folderPath) => {
  try {
    const target = folderPath || loadSettings().outputDir || path.join(app.getPath('videos'), 'VELVY_OUTPUTS');
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }
    await shell.openPath(target);
    return true;
  } catch (err) {
    console.error('[VELVY STUDIO] Erro ao abrir pasta:', err);
    return false;
  }
});

// Salvar dump de diagnóstico técnico
ipcMain.handle('debug:saveDump', async (event, data) => {
  try {
    const scratchDir = path.join(__dirname, '..', 'scratch');
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    fs.writeFileSync(path.join(scratchDir, 'runninghub_probe.json'), JSON.stringify(data, null, 2), 'utf-8');
    console.log('[VELVY STUDIO] Dump salvo em scratch/runninghub_probe.json');
    return true;
  } catch (err) {
    console.error('[VELVY STUDIO] Erro salvando dump:', err);
    return false;
  }
});

// ========================================================
// GITHUB AUTO-UPDATE SYSTEM & IPC HANDLERS
// ========================================================
async function runAutoUpdateCheck() {
  try {
    const currentVer = pkg.version || '1.0.0';
    console.log(`[UPDATER] Checando novas versões via GitHub (Versão local: v${currentVer})...`);
    const result = await checkForUpdates(currentVer);
    if (result && result.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
      console.log(`[UPDATER] Nova versão detectada: v${result.latestVersion}! Enviando para a interface...`);
      mainWindow.webContents.send('updater:new-version-available', result);
    }
    return result;
  } catch (e) {
    console.warn('[UPDATER] Aviso na checagem de atualização:', e.message);
    return { updateAvailable: false };
  }
}

ipcMain.handle('updater:check', async () => {
  return await runAutoUpdateCheck();
});

ipcMain.handle('updater:simulate-test', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:new-version-available', {
      updateAvailable: true,
      currentVersion: pkg.version || '1.0.0',
      latestVersion: '1.0.1',
      title: 'Velvy Studio Pro v1.0.1',
      notes: '✨ Novas automações integradas, Face Swap aprimorado e suporte a novas poses no Carrossel.',
      downloadUrl: 'https://github.com/velvyzap/velvy-studio/releases/latest/download/VelvyStudio-Setup-1.0.1.exe'
    });
  }
  return { success: true };
});

ipcMain.handle('updater:download-install', async (event, updateInfo) => {
  try {
    const url = updateInfo && updateInfo.downloadUrl;
    if (!url) {
      throw new Error('URL de download não encontrada para a versão.');
    }

    console.log('[UPDATER] Iniciando download da atualização:', url);
    const installerPath = await downloadUpdate(url, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', progress);
      }
    });

    console.log('[UPDATER] Download concluído! Executando instalador e reiniciando aplicação:', installerPath);
    applyUpdateAndRestart(installerPath, app);
    return { success: true };
  } catch (err) {
    console.error('[UPDATER] Erro durante o download ou aplicação da atualização:', err);
    throw err;
  }
});

// App lifecycle
app.whenReady().then(() => {
  startDedicatedServer();
  createSplashWindow();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  if (localHttpServer) {
    localHttpServer.close();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
