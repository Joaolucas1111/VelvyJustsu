/**
 * VELVY STUDIO — GITHUB AUTO-UPDATE ENGINE
 * Verifica novas versões no repositório GitHub e gerencia o download/instalação
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const configPath = path.join(__dirname, 'update-config.json');
let updateConfig = {
  githubOwner: 'velvyzap',
  githubRepo: 'velvy-studio',
  checkIntervalMinutes: 15,
  manifestUrl: 'https://raw.githubusercontent.com/velvyzap/velvy-studio/main/version.json',
  releasesApiUrl: 'https://api.github.com/repos/velvyzap/velvy-studio/releases/latest'
};

if (fs.existsSync(configPath)) {
  try {
    updateConfig = { ...updateConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
  } catch (e) {
    console.warn('[UPDATER] Aviso ao ler update-config.json:', e.message);
  }
}

// Comparação simples de Semver (Retorna: 1 se v1 > v2, -1 se v1 < v2, 0 se iguais)
function compareVersions(v1, v2) {
  const clean = (v) => (v || '').replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n, 10) || 0);
  const p1 = clean(v1);
  const p2 = clean(v2);
  const len = Math.max(p1.length, p2.length);

  for (let i = 0; i < len; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

// Requisição HTTP/HTTPS com suporte a redirecionamentos (301, 302, 307, 308)
function fetchWithRedirect(url, options = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Muitos redirecionamentos'));

    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'VelvyStudio-AutoUpdater/1.0.0',
      'Accept': 'application/json, text/plain, */*',
      ...(options.headers || {})
    };

    const req = client.get(url, { headers }, (res) => {
      // Redirecionamento
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let nextUrl = res.headers.location;
        if (!nextUrl.startsWith('http')) {
          nextUrl = new URL(nextUrl, url).toString();
        }
        res.resume(); // Consome para liberar socket
        return fetchWithRedirect(nextUrl, options, maxRedirects - 1).then(resolve).catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`HTTP Status ${res.statusCode} ao consultar ${url}`));
      }

      resolve(res);
    });

    req.on('error', reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Timeout de conexão ao verificar atualização'));
    });
  });
}

// Verifica atualizações via Manifest (version.json no raw github) ou Releases API
async function checkForUpdates(currentVersion) {
  try {
    // 1. Tenta manifestUrl (raw.githubusercontent.com - sem rate limits severos da API)
    if (updateConfig.manifestUrl) {
      try {
        const res = await fetchWithRedirect(updateConfig.manifestUrl);
        let raw = '';
        for await (const chunk of res) raw += chunk;
        const data = JSON.parse(raw);

        if (data && data.version) {
          const isNewer = compareVersions(data.version, currentVersion) > 0;
          return {
            updateAvailable: isNewer,
            currentVersion: currentVersion,
            latestVersion: data.version,
            title: data.title || `Versão ${data.version}`,
            notes: data.notes || 'Novas melhorias e correções implementadas.',
            downloadUrl: data.downloadUrl || null,
            mandatory: !!data.mandatory
          };
        }
      } catch (errManifest) {
        console.warn('[UPDATER] Falha ao consultar manifest, tentando Releases API:', errManifest.message);
      }
    }

    // 2. Fallback para GitHub Releases API
    if (updateConfig.releasesApiUrl) {
      try {
        const res = await fetchWithRedirect(updateConfig.releasesApiUrl);
        let raw = '';
        for await (const chunk of res) raw += chunk;
        const release = JSON.parse(raw);

        if (release && release.tag_name) {
          const remoteVer = release.tag_name.replace(/^v/i, '');
          const isNewer = compareVersions(remoteVer, currentVersion) > 0;

          let exeAsset = null;
          if (Array.isArray(release.assets)) {
            exeAsset = release.assets.find(a => a.name && (a.name.endsWith('.exe') || a.name.includes('Setup')));
          }

          return {
            updateAvailable: isNewer,
            currentVersion: currentVersion,
            latestVersion: remoteVer,
            title: release.name || `Velvy Studio v${remoteVer}`,
            notes: release.body || 'Atualização disponível no repositório.',
            downloadUrl: exeAsset ? exeAsset.browser_download_url : release.html_url,
            mandatory: false
          };
        }
      } catch (errRel) {
        console.warn('[UPDATER] Releases API indisponível, tentando fallback:', errRel.message);
      }
    }

    // 3. Fallback inteligente para Servidor de Licenças / API local
    const fallbackUrl = updateConfig.fallbackServerUrl || 'http://localhost:7777/version.json';
    try {
      const res = await fetchWithRedirect(fallbackUrl);
      let raw = '';
      for await (const chunk of res) raw += chunk;
      const data = JSON.parse(raw);
      if (data && data.version) {
        const isNewer = compareVersions(data.version, currentVersion) > 0;
        return {
          updateAvailable: isNewer,
          currentVersion: currentVersion,
          latestVersion: data.version,
          title: data.title || `Versão ${data.version}`,
          notes: data.notes || 'Novas melhorias e correções implementadas.',
          downloadUrl: data.downloadUrl || null,
          mandatory: !!data.mandatory
        };
      }
    } catch (eFallback) {
      // Ignora falha de fallback se offline
    }
  } catch (err) {
    console.error('[UPDATER] Erro ao verificar atualização:', err.message);
  }

  return { updateAvailable: false, currentVersion };
}

// Download com stream e envio contínuo de progresso
async function downloadUpdate(downloadUrl, onProgress) {
  return new Promise(async (resolve, reject) => {
    try {
      const tempPath = path.join(os.tmpdir(), `VelvyStudio-Update-Setup-${Date.now()}.exe`);
      const fileStream = fs.createWriteStream(tempPath);

      const res = await fetchWithRedirect(downloadUrl);
      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let receivedBytes = 0;

      res.on('data', (chunk) => {
        receivedBytes += chunk.length;
        fileStream.write(chunk);

        if (totalBytes > 0 && typeof onProgress === 'function') {
          const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
          onProgress({
            percent,
            receivedBytes,
            totalBytes,
            receivedMB: (receivedBytes / (1024 * 1024)).toFixed(1),
            totalMB: (totalBytes / (1024 * 1024)).toFixed(1)
          });
        }
      });

      res.on('end', () => {
        fileStream.end();
        console.log(`[UPDATER] Download concluído com sucesso: ${tempPath} (${receivedBytes} bytes)`);
        resolve(tempPath);
      });

      res.on('error', (err) => {
        fileStream.close();
        fs.unlink(tempPath, () => {});
        reject(err);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Aplica a atualização executando o instalador e encerrando a instância atual
function applyUpdateAndRestart(installerPath, app) {
  try {
    console.log(`[UPDATER] Executando instalador: ${installerPath}`);
    const child = spawn(installerPath, ['--updated'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    setTimeout(() => {
      app.quit();
    }, 800);
    return true;
  } catch (err) {
    console.error('[UPDATER] Falha ao iniciar instalador:', err);
    return false;
  }
}

module.exports = {
  compareVersions,
  checkForUpdates,
  downloadUpdate,
  applyUpdateAndRestart
};
