/**
 * VELVY STUDIO — CLIENT LICENSING & HWID ENGINE
 * Gerencia a ativação de licença, trava no hardware (HWID) e validação criptográfica.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

// Chave pública / sal para integridade local
const LOCAL_SALT = 'VELVY_STUDIO_CLIENT_INTEGRITY_SALT_2026';

// 1. OBTENÇÃO DO HWID EXCLUSIVO DO COMPUTADOR
function getMachineHWID() {
  let guid = '';
  try {
    const cmd = 'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid';
    const out = execSync(cmd, { encoding: 'utf-8', windowsHide: true });
    const match = out.match(/MachineGuid\s+REG_SZ\s+([a-fA-F0-9-]+)/i);
    if (match) guid = match[1].trim();
  } catch (e) {
    try {
      guid = os.hostname() + '-' + os.userInfo().username;
    } catch (err2) {
      guid = 'DEFAULT-VELVY-PC';
    }
  }

  const raw = `${guid}|${os.arch()}|${os.platform()}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return `HWID-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}`;
}

// 2. ARMAZENAMENTO LOCAL DA LICENÇA CRIPTOGRAFADA
function getLicenseFilePath(app) {
  const userDir = app.getPath('userData');
  return path.join(userDir, 'velvy_license.enc');
}

function encryptLocal(text) {
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    crypto.createHash('sha256').update(LOCAL_SALT).digest(),
    Buffer.alloc(16, 0)
  );
  let crypted = cipher.update(text, 'utf8', 'hex');
  crypted += cipher.final('hex');
  return crypted;
}

function decryptLocal(text) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      crypto.createHash('sha256').update(LOCAL_SALT).digest(),
      Buffer.alloc(16, 0)
    );
    let dec = decipher.update(text, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch (e) {
    return null;
  }
}

function loadLocalLicense(app) {
  const p = getLicenseFilePath(app);
  if (!fs.existsSync(p)) return null;

  try {
    const raw = fs.readFileSync(p, 'utf-8').trim();
    const jsonStr = decryptLocal(raw);
    if (!jsonStr) return null;
    return JSON.parse(jsonStr);
  } catch (e) {
    return null;
  }
}

function saveLocalLicense(app, data) {
  const p = getLicenseFilePath(app);
  try {
    const encrypted = encryptLocal(JSON.stringify(data));
    fs.writeFileSync(p, encrypted, 'utf-8');
    return true;
  } catch (e) {
    console.error('[ERRO] Falha ao salvar licença local:', e);
    return false;
  }
}

// 3. VERIFICAÇÃO DE LICENÇA (OFFLINE E ONLINE)
function verifyLicenseStatus(app) {
  const currentHWID = getMachineHWID();
  const saved = loadLocalLicense(app);

  if (!saved || !saved.key || !saved.token) {
    return {
      active: false,
      hwid: currentHWID,
      reason: 'Nenhuma chave de licença encontrada. Ativação necessária.'
    };
  }

  // Verifica se a licença salva pertence a ESTE computador
  if (saved.hwid !== currentHWID) {
    return {
      active: false,
      hwid: currentHWID,
      reason: 'Esta licença foi ativada em outro computador. HWID divergente.'
    };
  }

  // Verifica data de expiração (se não for vitalício)
  if (saved.expiresAt !== -1 && saved.expiresAt < Date.now()) {
    return {
      active: false,
      hwid: currentHWID,
      reason: 'Sua licença de uso expirou. Adquira uma nova chave no Discord.'
    };
  }

  return {
    active: true,
    hwid: currentHWID,
    key: saved.key,
    plan: saved.plan || 'Padrão Pro',
    expiresAt: saved.expiresAt
  };
}

// 4. ATIVAÇÃO REMOTA JUNTO AO BOT DO DISCORD (API)
function activateWithServer(app, key, serverUrl = 'http://localhost:7777') {
  return new Promise((resolve) => {
    const hwid = getMachineHWID();
    const cleanKey = (key || '').trim().toUpperCase();

    if (!cleanKey) {
      return resolve({ success: false, error: 'Por favor, insira a chave de ativação.' });
    }

    try {
      const url = new URL('/api/activate', serverUrl);
      const isHttps = url.protocol === 'https:';
      const clientLib = isHttps ? https : http;

      const body = JSON.stringify({ key: cleanKey, hwid: hwid });
      const req = clientLib.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: 8000
        },
        (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              if (res.statusCode >= 200 && res.statusCode < 300 && json.success) {
                // Salva a licença no arquivo local criptografado
                saveLocalLicense(app, {
                  key: cleanKey,
                  hwid: hwid,
                  token: json.token,
                  plan: json.plan,
                  days: json.days,
                  expiresAt: json.expiresAt,
                  activatedAt: Date.now()
                });

                return resolve({
                  success: true,
                  plan: json.plan,
                  expiresAt: json.expiresAt
                });
              } else {
                return resolve({
                  success: false,
                  error: json.error || `Erro de ativação (Código ${res.statusCode})`
                });
              }
            } catch (err) {
              return resolve({ success: false, error: 'Resposta inválida do servidor de licenças.' });
            }
          });
        }
      );

      req.on('error', (err) => {
        return resolve({
          success: false,
          error: `Não foi possível conectar ao servidor de licenças: ${err.message}. Verifique sua conexão ou se o bot está online.`
        });
      });

      req.on('timeout', () => {
        req.destroy();
        return resolve({ success: false, error: 'Tempo limite esgotado ao contatar o servidor de licenças.' });
      });

      req.write(body);
      req.end();
    } catch (e) {
      return resolve({ success: false, error: 'URL do servidor de licenças inválida.' });
    }
  });
}

module.exports = {
  getMachineHWID,
  verifyLicenseStatus,
  activateWithServer
};
