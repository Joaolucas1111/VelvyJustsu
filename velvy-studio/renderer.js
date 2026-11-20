// Polyfill & Fallback para caso seja aberto diretamente no navegador web (http://localhost:7890)
if (!window.electronAPI) {
  console.warn('[VELVY STUDIO] Executando fora do Electron. Ativando modo Web Fallback.');
  window.electronAPI = {
    loadSettings: async () => {
      const saved = localStorage.getItem('velvy_settings');
      if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
      }
      return {
        workflowUrl: 'https://www.runninghub.ai/pt-br/workflow/2123548590904102913',
        gpuTier: 'Lite/Plus',
        initDelaySeconds: 270,
        outputDir: 'Downloads/VELVY_OUTPUTS',
        autoDownload: true,
        headlessRun: false
      };
    },
    saveSettings: async (settings) => {
      localStorage.setItem('velvy_settings', JSON.stringify(settings));
      return true;
    },
    openFileDialog: async ({ type }) => {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = type === 'video' ? 'video/mp4,video/*' : 'image/*';
        input.onchange = (e) => {
          if (e.target.files && e.target.files[0]) {
            const f = e.target.files[0];
            resolve({ path: f.name, name: f.name, size: f.size, fileObj: f });
          } else {
            resolve(null);
          }
        };
        input.click();
      });
    },
    openDirectoryDialog: async () => {
      return 'Pasta Padrão de Downloads';
    },
    openFolder: async () => {
      alert('Abrindo pasta de downloads local...');
      return true;
    }
  };

  window.isWebMode = true;
} else {
  window.isWebMode = false;
}

// State
let queue = [];
let isQueueRunning = false;
let currentTaskIndex = -1;
let currentPreviewVideoPath = null;
let appSettings = {};

// DOM Elements & Multi-Webview Deck Management
let currentActiveWebviewId = 'wv-video';

function getActiveWebview() {
  const el = document.getElementById(currentActiveWebviewId);
  if (el) return el;
  return document.querySelector('.runninghub-webview.active') || document.querySelector('.runninghub-webview') || document.querySelector('webview');
}

function getWebviewForModule(moduleName) {
  const map = {
    'video': 'wv-video',
    'face_swap': 'wv-faceswap',
    'faceswap': 'wv-faceswap',
    'upscale': 'wv-upscale',
    'clothes_swap': 'wv-clothes',
    'clothes': 'wv-clothes',
    'carousel': 'wv-carousel'
  };
  const targetId = map[moduleName] || currentActiveWebviewId;
  return document.getElementById(targetId) || getActiveWebview();
}

// Global webview proxy: routes any calls (executeJavaScript, reload, loadURL, etc.) to the active or target webview
const webview = new Proxy({}, {
  get(target, prop) {
    const wv = getActiveWebview();
    if (!wv) return undefined;
    const val = wv[prop];
    if (typeof val === 'function') {
      return val.bind(wv);
    }
    return val;
  },
  set(target, prop, val) {
    const wv = getActiveWebview();
    if (wv) wv[prop] = val;
    return true;
  }
});
const queueBadge = document.getElementById('queue-badge');
const queueContainer = document.getElementById('queue-items-container');
const historyFullContainer = document.getElementById('history-full-container');
const queueSummary = document.getElementById('queue-summary');
const platformDot = document.getElementById('platform-status-dot');
const workflowStatusText = document.getElementById('workflow-status-text');
const workflowStatusPill = document.getElementById('workflow-status-pill');
const toastEl = document.getElementById('toast');
const videoPlayer = document.getElementById('video-player');
const videoPlaceholder = document.getElementById('video-placeholder');
const progressBar = document.getElementById('progressBar');
const progressContainer = document.getElementById('progress');
const progressStatusText = document.getElementById('progress-status-text');
const generateBtnText = document.getElementById('generate-btn-text');

// =========================================================================
// CAMADA DE SEGURANÇA COMERCIAL: LICENCIAMENTO, HWID & MODO STEALTH
// =========================================================================

let isAppLicensed = false;
let clientHWID = '';
let isClientStealthMode = true; // Por padrão, os clientes nunca visualizam os nós do workflow

// Oculta e protege a visualização dos nós de workflow para o cliente final sem interferir na execução da IA
async function injectStealthShieldToWebview(wv) {
  if (!wv || !isClientStealthMode) return;
  const script = `
    (() => {
      if (document.getElementById('velvy-stealth-shield')) return;

      const style = document.createElement('style');
      style.id = 'velvy-stealth-style';
      style.textContent = \`
        #graph-canvas, .lgraphcanvas, .litegraph {
          filter: blur(20px) grayscale(90%) !important;
          opacity: 0.12 !important;
          pointer-events: none !important;
        }
      \`;
      try { document.head.appendChild(style); } catch (e) {}

      const shield = document.createElement('div');
      shield.id = 'velvy-stealth-shield';
      shield.style.cssText = \`
        position: fixed;
        top: 56px;
        left: 0;
        right: 0;
        bottom: 0;
        background: radial-gradient(circle at center, rgba(16, 9, 28, 0.94), rgba(8, 4, 15, 0.98));
        z-index: 999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: #e2d9f3;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        pointer-events: none;
      \`;
      shield.innerHTML = \`
        <div style="text-align:center;padding:36px 48px;background:rgba(22, 12, 38, 0.85);border-radius:18px;border:1px solid #4a237e;box-shadow:0 0 35px rgba(124,58,237,0.25);">
          <div style="font-size:44px;margin-bottom:12px;">🛡️</div>
          <h2 style="margin:0 0 6px 0;font-size:20px;color:#fff;font-weight:700;">Motor Velvy Studio Conectado</h2>
          <p style="margin:0 0 14px 0;font-size:13px;color:#a894c7;max-width:360px;">Workflows, nós e modelos de IA operam com segurança em segundo plano.</p>
          <div style="font-size:11px;color:#7c3aed;background:#10061e;padding:6px 14px;border-radius:8px;border:1px solid #281245;font-weight:600;">
            ✦ Sessão RunningHub Ativa & Pronta para Gerações
          </div>
        </div>
      \`;
      try { document.body.appendChild(shield); } catch (e) {}
    })();
  `;
  try {
    await wv.executeJavaScript(script);
  } catch (e) {}
}

async function removeStealthShieldFromWebviews() {
  const script = `
    (() => {
      const shield = document.getElementById('velvy-stealth-shield');
      if (shield) shield.remove();
      const style = document.getElementById('velvy-stealth-style');
      if (style) style.remove();
    })();
  `;
  ['wv-video', 'wv-faceswap', 'wv-upscale', 'wv-clothes', 'wv-carousel'].forEach(async (id) => {
    const wv = document.getElementById(id);
    if (wv) {
      try { await wv.executeJavaScript(script); } catch (e) {}
    }
  });
}

// Alternador Secreto de Modo Desenvolvedor (5 cliques no Logo)
let logoClickCount = 0;
let logoClickTimer = null;
function setupAdminSecretToggle() {
  const logo = document.querySelector('.logo-wrap');
  if (!logo) return;

  logo.addEventListener('click', async () => {
    logoClickCount++;
    clearTimeout(logoClickTimer);
    logoClickTimer = setTimeout(() => { logoClickCount = 0; }, 2500);

    if (logoClickCount >= 5) {
      logoClickCount = 0;
      isClientStealthMode = !isClientStealthMode;
      const devTools = document.getElementById('admin-dev-tools');
      const shieldIndicator = document.getElementById('shield-status-indicator');

      if (isClientStealthMode) {
        if (devTools) devTools.style.display = 'none';
        if (shieldIndicator) {
          shieldIndicator.textContent = '🛡️ Modo Seguro Ativo (Workflows Protegidos)';
          shieldIndicator.style.color = '#34d399';
        }
        ['wv-video', 'wv-faceswap', 'wv-upscale', 'wv-clothes', 'wv-carousel'].forEach(id => {
          const wv = document.getElementById(id);
          if (wv) injectStealthShieldToWebview(wv);
        });
        showToast('🔒 Modo Cliente Ativado (Workflows Ocultados)');
      } else {
        if (devTools) devTools.style.display = 'flex';
        if (shieldIndicator) {
          shieldIndicator.textContent = '🔓 Modo Desenvolvedor Ativo';
          shieldIndicator.style.color = '#f59e0b';
        }
        await removeStealthShieldFromWebviews();
        showToast('🔓 Modo Desenvolvedor Ativado (Workflows e Ferramentas Visíveis)');
      }
    }
  });
}

// Sistema de Verificação e Ativação de Licença (First-Use HWID Lock)
async function setupLicensingSystem() {
  const modal = document.getElementById('activation-modal');
  const hwidEl = document.getElementById('activation-hwid-text');
  const btnCopy = document.getElementById('btn-copy-hwid');
  const keyInput = document.getElementById('activation-key-input');
  const btnSubmit = document.getElementById('btn-submit-activation');
  const statusMsg = document.getElementById('activation-status-msg');

  if (!window.electronAPI || !window.electronAPI.getLicenseStatus) {
    return;
  }

  try {
    const status = await window.electronAPI.getLicenseStatus();
    clientHWID = status ? status.hwid : '';
    if (hwidEl && clientHWID) hwidEl.textContent = clientHWID;

    if (status && status.active) {
      isAppLicensed = true;
      if (modal) modal.style.display = 'none';
      console.log(`[VELVY STUDIO] Licença verificada com sucesso: Plano ${status.plan}`);
    } else {
      isAppLicensed = false;
      if (modal) modal.style.display = 'flex';
      if (statusMsg && status && status.reason) {
        statusMsg.textContent = status.reason;
        statusMsg.style.color = '#f87171';
      }
    }
  } catch (err) {
    console.warn('[VELVY STUDIO] Erro ao verificar licença:', err);
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', () => {
      if (clientHWID) {
        navigator.clipboard.writeText(clientHWID);
        showToast('📋 HWID copiado com sucesso!');
      }
    });
  }

  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      const key = keyInput ? keyInput.value.trim().toUpperCase() : '';
      if (!key) {
        if (statusMsg) {
          statusMsg.textContent = '⚠️ Digite ou cole a sua chave de ativação.';
          statusMsg.style.color = '#f87171';
        }
        return;
      }

      btnSubmit.disabled = true;
      if (statusMsg) {
        statusMsg.textContent = '⏳ Conectando ao servidor e vinculando chave ao seu PC...';
        statusMsg.style.color = '#a894c7';
      }

      try {
        const res = await window.electronAPI.activateLicense(key);
        if (res && res.success) {
          isAppLicensed = true;
          if (statusMsg) {
            statusMsg.textContent = `✅ Licença ativada com sucesso! Plano: ${res.plan || 'Pro'}`;
            statusMsg.style.color = '#34d399';
          }
          showToast(`🎉 Velvy Studio ativado com sucesso! Seja bem-vindo!`, 6000);
          setTimeout(() => {
            if (modal) {
              modal.style.transition = 'opacity 0.4s ease';
              modal.style.opacity = '0';
              setTimeout(() => { modal.style.display = 'none'; }, 400);
            }
          }, 1200);
        } else {
          if (statusMsg) {
            statusMsg.textContent = `❌ ${res ? res.error : 'Falha na validação da chave.'}`;
            statusMsg.style.color = '#f87171';
          }
        }
      } catch (err) {
        if (statusMsg) {
          statusMsg.textContent = `❌ Erro de conexão: ${err.message}`;
          statusMsg.style.color = '#f87171';
        }
      } finally {
        btnSubmit.disabled = false;
      }
    });
  }

  setupAdminSecretToggle();
}

// ========================================================
// GITHUB AUTO-UPDATE UI & PROGRESS OVERLAY
// ========================================================
let pendingUpdateInfo = null;

function setupAutoUpdaterUI() {
  const bar = document.getElementById('update-notification-bar');
  const vTag = document.getElementById('update-version-tag');
  const notesText = document.getElementById('update-notes-text');
  const btnNow = document.getElementById('btn-update-now');
  const btnLater = document.getElementById('btn-update-later');
  const overlay = document.getElementById('update-screen-overlay');
  const pBar = document.getElementById('update-progress-bar');
  const pSubtitle = document.getElementById('update-progress-subtitle');
  const pPercent = document.getElementById('update-percent-label');
  const pBytes = document.getElementById('update-bytes-label');
  const btnCheck = document.getElementById('btn-check-updates');
  const btnSimulate = document.getElementById('btn-simulate-update');
  const settingsStatus = document.getElementById('settings-update-status');

  if (!window.electronAPI) return;

  // Escuta novas versões disponíveis enviadas pelo backend do Electron
  if (typeof window.electronAPI.onUpdateAvailable === 'function') {
    window.electronAPI.onUpdateAvailable((info) => {
      if (!info || !info.updateAvailable) return;
      pendingUpdateInfo = info;
      if (vTag) vTag.textContent = `v${info.latestVersion}`;
      if (notesText) notesText.textContent = info.notes || 'Melhorias de desempenho e novas automações prontas para instalação.';
      if (bar) {
        bar.style.display = 'flex';
      }
      showToast(`🚀 Nova atualização v${info.latestVersion} disponível!`, 6000);
    });
  }

  // Escuta o progresso de download da atualização
  if (typeof window.electronAPI.onUpdateProgress === 'function') {
    window.electronAPI.onUpdateProgress((prog) => {
      if (!prog) return;
      if (pBar) pBar.style.width = `${prog.percent}%`;
      if (pPercent) pPercent.textContent = `${prog.percent}%`;
      if (pBytes) pBytes.textContent = `${prog.receivedMB} MB de ${prog.totalMB} MB`;
      if (prog.percent >= 100 && pSubtitle) {
        pSubtitle.textContent = 'Download finalizado! Reiniciando e aplicando atualização...';
      }
    });
  }

  // Botão "Lembrar Depois"
  if (btnLater) {
    btnLater.addEventListener('click', () => {
      if (bar) bar.style.display = 'none';
      showToast('Aviso de atualização silenciado.');
    });
  }

  // Botão "Atualizar Agora"
  if (btnNow) {
    btnNow.addEventListener('click', async () => {
      if (!pendingUpdateInfo) return;
      if (bar) bar.style.display = 'none';
      if (overlay) overlay.style.display = 'flex';

      if (pBar) pBar.style.width = '0%';
      if (pPercent) pPercent.textContent = '0%';
      if (pBytes) pBytes.textContent = 'Iniciando download...';
      if (pSubtitle) pSubtitle.textContent = `Baixando nova versão v${pendingUpdateInfo.latestVersion} do GitHub...`;

      try {
        await window.electronAPI.downloadAndInstallUpdate(pendingUpdateInfo);
      } catch (err) {
        console.error('[UPDATER UI] Falha na atualização:', err);
        if (pSubtitle) {
          pSubtitle.textContent = `❌ Falha ao atualizar: ${err.message}. Tente novamente.`;
          pSubtitle.style.color = '#ef4444';
        }
        setTimeout(() => {
          if (overlay) overlay.style.display = 'none';
          showToast(`Erro na atualização: ${err.message}`, 5000);
        }, 4000);
      }
    });
  }

  // Botão em Configurações: Verificar Atualizações
  if (btnCheck) {
    btnCheck.addEventListener('click', async () => {
      if (settingsStatus) settingsStatus.textContent = 'Verificando atualizações no GitHub...';
      btnCheck.disabled = true;
      try {
        const res = await window.electronAPI.checkForUpdates();
        if (res && res.updateAvailable) {
          if (settingsStatus) settingsStatus.textContent = `✅ Nova versão v${res.latestVersion} encontrada! Notificação exibida abaixo.`;
          pendingUpdateInfo = res;
          if (vTag) vTag.textContent = `v${res.latestVersion}`;
          if (notesText) notesText.textContent = res.notes || 'Novas melhorias disponíveis.';
          if (bar) bar.style.display = 'flex';
        } else {
          if (settingsStatus) settingsStatus.textContent = '✓ Você já está utilizando a versão mais recente!';
          showToast('✓ Nenhuma atualização pendente. Sistema 100% atualizado!');
        }
      } catch (e) {
        if (settingsStatus) settingsStatus.textContent = `Erro ao verificar: ${e.message}`;
      } finally {
        btnCheck.disabled = false;
      }
    });
  }

  // Botão em Configurações: Simular Notificação
  if (btnSimulate) {
    btnSimulate.addEventListener('click', async () => {
      showToast('Simulando notificação de atualização...', 2000);
      await window.electronAPI.simulateUpdateTest();
    });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupLicensingSystem();
  setupFilePickers();
  setupQueueControls();
  setupPlatformControls();
  setupSettings();
  setupInspector();
  setupPreviewActions();
  setupNewModulesUI();
  setupAutoUpdaterUI();

  // Load Settings
  appSettings = await window.electronAPI.loadSettings();
  applySettingsToUI();

  if (window.isWebMode) {
    showToast('⚠️ Modo Navegador ativo. Para automação em 2º plano, execute: iniciar_velvy_studio.bat', 7000);
  }

  // Webview lifecycle & Live Watcher
  setupWebviewEvents();
  setWorkflowState('offline', 'Aguardando Plataforma...');
  startDOMStateWatcher();
});

// Toast notification
function showToast(message, duration = 3000) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), duration);
}

// Tabs
function setupTabs() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');
  const topbarWelcome = document.getElementById('topbar-welcome');

  const titles = {
    'queue-tab': {
      title: 'Criar Novo Vídeo (Engine Pro)',
      subtitle: 'Envie suas referências e deixe a IA criar seu vídeo com movimento fluido.',
      welcome: 'Transforme suas ideias em vídeos incríveis com IA ✨'
    },
    'faceswap-tab': {
      title: 'Face Swap Ultrarrealista (Klein 9B)',
      subtitle: 'Troca o rosto da modelo preservando expressões, iluminação e anatomia natural.',
      welcome: 'Módulo Face Swap • Flux 2 Klein 9B ativo 🎭'
    },
    'upscale-tab': {
      title: 'Ultra-Detalhamento & 4K Cinema Upscale',
      subtitle: 'Eleva imagens para 4K adicionando micro-texturas na pele, olhos, cabelos e iluminação.',
      welcome: 'Módulo 4K Cinema • SeedVR2 + Z-Image ativo 💎'
    },
    'clothes-tab': {
      title: 'Trocador de Roupa Inteligente',
      subtitle: 'Substitui o look da sua modelo por uma peça nova mantendo pose, iluminação e anatomia.',
      welcome: 'Módulo Troca de Roupa • Flux Outfit Changer ativo 👗'
    },
    'carousel-tab': {
      title: 'Gerador de Carrossel Multi-Pose',
      subtitle: 'Gera variações consistentes de poses e expressões da sua modelo para Instagram & TikTok.',
      welcome: 'Módulo Carrossel • Geração em lote de poses ativo 📸'
    },
    'platform-tab': {
      title: 'Plataforma Web (RunningHub)',
      subtitle: 'Faça login na sua conta e carregue seu workflow',
      welcome: 'Ambiente de nuvem em segundo plano • Zero-Créditos ativo ⚡'
    },
    'history-tab': {
      title: 'Histórico & Fileira Completa',
      subtitle: 'Todos os vídeos finalizados e tarefas registradas durante a sessão.',
      welcome: 'Galeria de gerações salvas no seu computador 🎬'
    },
    'inspector-tab': {
      title: 'Mapeador de Elementos DOM',
      subtitle: 'Análise de nós, botões de execução e elementos da plataforma',
      welcome: 'Diagnóstico e inspeção técnica da nuvem 🔬'
    },
    'settings-tab': {
      title: 'Configurações do Estúdio',
      subtitle: 'Ajuste tempos de espera, URLs e pastas de salvamento',
      welcome: 'Configurações globais de automação ⚙'
    },
    'frame-extractor-tab': {
      title: 'Frame Extractor',
      subtitle: 'Extraia frames de vídeos facilmente sem precisar abrir abas externas no navegador',
      welcome: 'Ferramenta utilitária de extração de frames 🎞️'
    }
  };

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      const dataMode = btn.getAttribute('data-mode');

      navBtns.forEach(b => b.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');

      if (titles[targetId]) {
        if (pageTitle) pageTitle.textContent = titles[targetId].title;
        if (pageSubtitle) pageSubtitle.textContent = titles[targetId].subtitle;
        if (topbarWelcome) topbarWelcome.textContent = titles[targetId].welcome;
      }

      if (dataMode) {
        const wvMap = {
          'video': 'wv-video',
          'face_swap': 'wv-faceswap',
          'upscale': 'wv-upscale',
          'clothes_swap': 'wv-clothes',
          'carousel': 'wv-carousel'
        };
        const targetWvId = wvMap[dataMode] || 'wv-video';
        currentActiveWebviewId = targetWvId;

        // Sincroniza botões de sub-aba da plataforma
        document.querySelectorAll('.platform-subtab-btn').forEach(sb => {
          sb.classList.toggle('active', sb.getAttribute('data-target-wv') === targetWvId);
        });
        // Sincroniza webviews visíveis no deck
        document.querySelectorAll('.runninghub-webview').forEach(w => {
          w.classList.toggle('active', w.id === targetWvId);
        });

        const activeWv = document.getElementById(targetWvId);
        const urlBar = document.getElementById('wv-url-bar');
        const badge = document.getElementById('active-wv-badge');
        if (activeWv && urlBar) {
          try {
            urlBar.value = activeWv.getURL() || activeWv.getAttribute('src') || '';
          } catch (e) {
            urlBar.value = activeWv.getAttribute('src') || '';
          }
        }
        if (badge) {
          const modTitles = { video: 'Vídeo Engine', face_swap: 'Face Swap', upscale: '4K Upscale', clothes_swap: 'Troca Roupa', carousel: 'Carrossel' };
          badge.textContent = `Aba: ${modTitles[dataMode] || dataMode}`;
        }

        if (dataMode === 'video') {
          restoreVideoNodesActive(activeWv);
        } else {
          switchWorkflowMode(dataMode);
        }
      }

      if (targetId === 'history-tab') {
        renderQueue();
      }
    });
  });

  // Shortcut link in bottom panel
  const btnViewAll = document.getElementById('btn-view-all-queue');
  if (btnViewAll) {
    btnViewAll.addEventListener('click', () => {
      const histBtn = document.querySelector('.nav-btn[data-tab="history-tab"]');
      if (histBtn) histBtn.click();
    });
  }

  // Upgrade Pro Button
  const btnUpgradePro = document.getElementById('btn-upgrade-pro');
  if (btnUpgradePro) {
    btnUpgradePro.addEventListener('click', () => {
      showToast('💎 Planos Pro em breve: Multi-GPUs simultâneas e nós ilimitados!');
    });
  }

  // Token Badge
  const tokenBadge = document.getElementById('token-badge');
  if (tokenBadge) {
    tokenBadge.addEventListener('click', () => {
      showToast('⚡ Zero Créditos: A tarefa é cancelada logo após o vídeo ser gerado!');
    });
  }
}

// File Pickers
function setupFilePickers() {
  const btnBrowseVideo = document.getElementById('btn-browse-video');
  const btnBrowseImage = document.getElementById('btn-browse-image');
  const dropVideo = document.getElementById('drop-video');
  const dropImage = document.getElementById('drop-image');
  const fileInputImage = document.getElementById('file-input-image');
  const fileInputVideo = document.getElementById('file-input-video');
  const imageThumb = document.getElementById('imageThumb');

  const selectVideo = async () => {
    const file = await window.electronAPI.openFileDialog({ type: 'video' });
    if (file) {
      document.getElementById('video-path').value = file.path;
      document.getElementById('video-label').textContent = file.name;
      dropVideo.classList.add('selected');
      if (!document.getElementById('task-name').value) {
        document.getElementById('task-name').value = file.name.replace(/\.[^/.]+$/, "");
      }
      showToast('🎬 Vídeo guia selecionado!');
    }
  };

  const selectImage = async () => {
    const file = await window.electronAPI.openFileDialog({ type: 'image' });
    if (file) {
      document.getElementById('image-path').value = file.path;
      document.getElementById('image-label').textContent = file.name;
      dropImage.classList.add('selected');

      // Tenta ler como base64 ou URL local para preview
      if (file.fileObj) {
        imageThumb.src = URL.createObjectURL(file.fileObj);
        imageThumb.style.display = 'block';
      } else {
        try {
          const imgData = await window.electronAPI.readFileBase64(file.path);
          if (imgData && imgData.base64) {
            imageThumb.src = `data:${imgData.mimeType};base64,${imgData.base64}`;
            imageThumb.style.display = 'block';
          }
        } catch (e) {
          imageThumb.style.display = 'none';
        }
      }
      showToast('🖼️ Foto de referência selecionada!');
    }
  };

  btnBrowseVideo.addEventListener('click', (e) => { e.stopPropagation(); selectVideo(); });
  dropVideo.addEventListener('click', (e) => { if (e.target !== btnBrowseVideo) selectVideo(); });

  btnBrowseImage.addEventListener('click', (e) => { e.stopPropagation(); selectImage(); });
  dropImage.addEventListener('click', (e) => { if (e.target !== btnBrowseImage) selectImage(); });

  // HTML5 Drag & Drop Support
  [dropVideo, dropImage].forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.style.borderColor = '#b34dff';
    });
    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      zone.style.borderColor = '';
    });
  });

  dropVideo.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneDropHandle(e, 'video');
  });

  dropImage.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneDropHandle(e, 'image');
  });

  function zoneDropHandle(e, type) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const filePath = file.path || file.name;
      if (type === 'video') {
        document.getElementById('video-path').value = filePath;
        document.getElementById('video-label').textContent = file.name;
        dropVideo.classList.add('selected');
        if (!document.getElementById('task-name').value) {
          document.getElementById('task-name').value = file.name.replace(/\.[^/.]+$/, "");
        }
        showToast('🎬 Vídeo carregado via arrastar!');
      } else {
        document.getElementById('image-path').value = filePath;
        document.getElementById('image-label').textContent = file.name;
        dropImage.classList.add('selected');
        imageThumb.src = URL.createObjectURL(file);
        imageThumb.style.display = 'block';
        showToast('🖼️ Imagem carregada via arrastar!');
      }
    }
  }
}

// Preview Player Actions
function setupPreviewActions() {
  const btnDownload = document.getElementById('btn-download-video');
  const btnOpenFolder = document.getElementById('btn-open-folder');
  const btnPlayPlaceholder = document.getElementById('btn-play-placeholder');
  const btnForceGrab = document.getElementById('btn-force-grab-video');
  const btnCancelCloud = document.getElementById('btn-cancel-cloud-task');
  const btnTogglePlay = document.getElementById('player-btn-toggle');
  const btnToggleMute = document.getElementById('player-btn-mute');
  const progressContainer = document.getElementById('player-progress-container');
  const progressFill = document.getElementById('player-progress-fill');
  const frame = document.getElementById('videoFrame');

  if (btnForceGrab) {
    btnForceGrab.addEventListener('click', async () => {
      await forceGrabCurrentVideo();
    });
  }

  if (btnCancelCloud) {
    btnCancelCloud.addEventListener('click', async () => {
      showToast('🛑 Solicitando cancelamento da tarefa na nuvem...');
      await triggerCloudTaskCancel();
    });
  }

  btnDownload.addEventListener('click', () => {
    if (currentPreviewVideoPath) {
      showToast(`💾 Vídeo já salvo com sucesso em:\n${currentPreviewVideoPath}`, 5000);
    } else {
      showToast('⚠️ Nenhum vídeo foi gerado ainda.');
    }
  });

  btnOpenFolder.addEventListener('click', async () => {
    const dir = appSettings.outputDir || 'VELVY_OUTPUTS';
    if (window.electronAPI.openFolder) {
      await window.electronAPI.openFolder(dir);
      showToast(`📁 Abrindo pasta: ${dir}`);
    } else {
      showToast(`Pasta de saída: ${dir}`);
    }
  });

  function togglePlayPause() {
    if (!videoPlayer || !videoPlayer.src) return;
    if (videoPlayer.paused) {
      videoPlayer.play().catch(() => {});
    } else {
      videoPlayer.pause();
    }
  }

  if (btnPlayPlaceholder) {
    btnPlayPlaceholder.addEventListener('click', () => {
      if (currentPreviewVideoPath && videoPlayer) {
        togglePlayPause();
      } else {
        showToast('Adicione uma tarefa e inicie a fileira para gerar vídeos ✨');
      }
    });
  }

  if (btnTogglePlay) {
    btnTogglePlay.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlayPause();
    });
  }

  if (btnToggleMute) {
    btnToggleMute.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!videoPlayer) return;
      videoPlayer.muted = !videoPlayer.muted;
      updateMuteButtonState();
    });
  }

  function updateMuteButtonState() {
    if (!btnToggleMute || !videoPlayer) return;
    if (videoPlayer.muted) {
      btnToggleMute.textContent = '🔇 Mudo';
      btnToggleMute.classList.remove('unmuted');
    } else {
      btnToggleMute.textContent = '🔊 Som';
      btnToggleMute.classList.add('unmuted');
    }
  }

  if (progressContainer) {
    progressContainer.addEventListener('click', (e) => {
      if (!videoPlayer || !videoPlayer.duration) return;
      const rect = progressContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      videoPlayer.currentTime = ratio * videoPlayer.duration;
    });
  }

  if (videoPlayer) {
    // Clique direto no vídeo pausa ou dá play
    videoPlayer.addEventListener('click', () => {
      togglePlayPause();
    });

    // Detecção automática de proporção (Vertical 9:16 vs Horizontal 16:9 / 16:10)
    videoPlayer.addEventListener('loadedmetadata', () => {
      const isVertical = videoPlayer.videoHeight > videoPlayer.videoWidth;
      if (frame) {
        if (isVertical) {
          frame.classList.add('vertical');
          frame.classList.remove('horizontal');
        } else {
          frame.classList.add('horizontal');
          frame.classList.remove('vertical');
        }
      }
    });

    videoPlayer.addEventListener('timeupdate', () => {
      const cur = formatTime(videoPlayer.currentTime);
      const dur = formatTime(videoPlayer.duration || 0);
      const timeDisplay = document.getElementById('player-time-display');
      if (timeDisplay) timeDisplay.textContent = `${cur} / ${dur}`;

      if (progressFill && videoPlayer.duration) {
        const pct = (videoPlayer.currentTime / videoPlayer.duration) * 100;
        progressFill.style.width = `${pct}%`;
      }
    });

    videoPlayer.addEventListener('play', () => {
      if (btnTogglePlay) btnTogglePlay.textContent = '⏸';
    });

    videoPlayer.addEventListener('pause', () => {
      if (btnTogglePlay) btnTogglePlay.textContent = '▶';
    });
  }
}

function formatTime(seconds) {
  if (isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function updateVideoPreview(filePath, taskName) {
  currentPreviewVideoPath = filePath;
  if (!videoPlayer) return;

  videoPlayer.src = filePath;
  videoPlayer.style.display = 'block';

  // IMPORTANTE: O vídeo já vem silenciado (mutado) por padrão
  videoPlayer.muted = true;
  videoPlayer.volume = 0.5;

  const btnToggleMute = document.getElementById('player-btn-mute');
  if (btnToggleMute) {
    btnToggleMute.textContent = '🔇 Mudo';
    btnToggleMute.classList.remove('unmuted');
  }

  if (videoPlaceholder) {
    videoPlaceholder.style.display = 'none';
  }

  const fileInfo = document.getElementById('player-file-info');
  if (fileInfo) fileInfo.textContent = taskName || 'Vídeo Finalizado';

  const check = document.getElementById('preview-check');
  if (check) check.style.background = '#10b981';

  videoPlayer.play().catch(() => {});
}

// Queue Controls
function setupQueueControls() {
  const btnAdd = document.getElementById('btn-add-queue');
  const btnStart = document.getElementById('btn-start-queue');
  const btnPause = document.getElementById('btn-pause-queue');
  const btnClear = document.getElementById('btn-clear-queue');

  btnAdd.addEventListener('click', () => {
    const videoPath = document.getElementById('video-path').value;
    let imagePath = document.getElementById('image-path').value;
    let imageName = document.getElementById('image-label').textContent;

    if (!imagePath && fixedFaceModel && fixedFaceModel.path) {
      imagePath = fixedFaceModel.path;
      imageName = `Modelo Fixada: ${fixedFaceModel.name}`;
    }

    const taskName = document.getElementById('task-name').value.trim() || `Dança_${queue.length + 1}`;

    if (!videoPath || !imagePath) {
      showToast('⚠️ Selecione a foto de referência (ou fixe uma modelo) e o vídeo guia antes de adicionar.');
      return;
    }

    const task = {
      id: Date.now().toString(),
      name: taskName,
      videoPath,
      videoName: document.getElementById('video-label').textContent,
      imagePath,
      imageName: imageName,
      status: 'waiting',
      createdAt: new Date().toLocaleTimeString(),
      progress: 0,
      outputVideo: null
    };

    queue.push(task);
    renderQueue();

    // Reset inputs
    document.getElementById('video-path').value = '';
    document.getElementById('image-path').value = '';
    document.getElementById('task-name').value = '';
    document.getElementById('video-label').textContent = 'Opcional • MP4/MOV (Movimento / Câmera)';
    document.getElementById('image-label').textContent = 'Arraste ou clique • PNG/JPG (Modelo / Roupa)';
    document.getElementById('drop-video').classList.remove('selected');
    document.getElementById('drop-image').classList.remove('selected');

    const imageThumb = document.getElementById('imageThumb');
    if (imageThumb) {
      imageThumb.style.display = 'none';
      imageThumb.src = '';
    }

    showToast(`✅ "${taskName}" adicionado à fileira!`);
  });

  // Inicialmente bloqueado até o workflow estar 100% pronto
  btnStart.disabled = true;
  btnStart.classList.add('locked');
  btnStart.title = 'Aguardando o workflow carregar por completo para liberar a fila.';

  btnStart.addEventListener('click', () => {
    if (workflowConnectionState !== 'ready') {
      showToast('⚠️ Workflow não está pronto. Acesse a aba "Plataforma Web" e aguarde os nós carregarem.');
      return;
    }
    if (queue.length === 0) {
      showToast('⚠️ Adicione tarefas à fila primeiro.');
      return;
    }
    isQueueRunning = true;
    btnStart.disabled = true;
    btnStart.classList.add('busy');
    btnPause.disabled = false;
    if (generateBtnText) generateBtnText.textContent = '⏳　Processando Fileira...';
    if (progressContainer) progressContainer.style.display = 'block';

    showToast('🚀 Fileira iniciada!');
    processNextInQueue();
  });

  btnPause.addEventListener('click', () => {
    isQueueRunning = false;
    btnStart.disabled = false;
    btnStart.classList.remove('busy');
    btnPause.disabled = true;
    if (generateBtnText) generateBtnText.textContent = '✦　Iniciar Fila de Geração　→';
    if (progressStatusText) progressStatusText.textContent = 'Fileira pausada pelo usuário.';
    showToast('⏸ Fileira pausada.');
  });

  btnClear.addEventListener('click', () => {
    queue = queue.filter(t => t.status !== 'done' && t.status !== 'canceled');
    renderQueue();
    showToast('Fila limpa.');
  });
}

function renderQueue() {
  if (queueBadge) queueBadge.textContent = queue.length;
  const waitingCount = queue.filter(t => t.status === 'waiting').length;
  if (queueSummary) queueSummary.textContent = `${queue.length} tarefas (${waitingCount} aguardando)`;

  const containers = [queueContainer, historyFullContainer].filter(Boolean);

  containers.forEach(container => {
    if (queue.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>Nenhuma tarefa na fileira.</p>
          <span>Selecione a foto e o vídeo guia acima e clique em "Adicionar à Fila" para iniciar o processamento em lote.</span>
        </div>`;
      return;
    }

    container.innerHTML = '';
    queue.forEach((task, idx) => {
      const card = document.createElement('div');
      card.className = `task-card ${task.status === 'running' ? 'active-running' : ''}`;

      const statusMap = {
        waiting: { label: 'Aguardando', class: 'status-waiting' },
        running: { label: 'Gerando...', class: 'status-running' },
        done: { label: 'Concluído', class: 'status-done' },
        error: { label: 'Erro', class: 'status-error' },
        canceled: { label: 'Cancelado', class: 'status-error' }
      };

      const st = statusMap[task.status] || statusMap.waiting;

      card.innerHTML = `
        <div class="task-card-left">
          <span class="task-index">#${idx + 1}</span>
          <div class="task-info">
            <h4>${task.name}</h4>
            <p>📹 ${task.videoName} | 🪞 ${task.imageName}</p>
          </div>
        </div>
        <div class="task-card-right">
          <span class="task-status-tag ${st.class}">${st.label}</span>
          ${task.status === 'done' && task.outputVideo ? 
            `<button class="btn-task-action btn-play-task" data-id="${task.id}" title="Assistir no Preview">▶ Assistir</button>` : ''}
          ${task.status === 'running' || task.status === 'waiting' ? 
            `<button class="btn-task-action btn-cancel-task" data-id="${task.id}">Cancelar</button>` : 
            `<button class="btn-task-action btn-remove-task" data-id="${task.id}">Remover</button>`}
        </div>
      `;

      container.appendChild(card);
    });
  });

  // Attach action buttons
  document.querySelectorAll('.btn-play-task').forEach(b => {
    b.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      const task = queue.find(t => t.id === id);
      if (task && task.outputVideo) {
        updateVideoPreview(task.outputVideo, task.name);
        showToast(`▶ Carregando "${task.name}" no player!`);
      }
    });
  });

  document.querySelectorAll('.btn-cancel-task').forEach(b => {
    b.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      cancelTask(id);
    });
  });

  document.querySelectorAll('.btn-remove-task').forEach(b => {
    b.addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      queue = queue.filter(t => t.id !== id);
      renderQueue();
    });
  });
}

function cancelTask(taskId) {
  const task = queue.find(t => t.id === taskId);
  if (task) {
    if (task.status === 'running') {
      triggerPlatformCancel();
    }
    task.status = 'canceled';
    renderQueue();
    showToast(`Tarefa "${task.name}" cancelada.`);
    if (isQueueRunning) processNextInQueue();
  }
}

async function processNextInQueue() {
  const targetWv = getWebviewForModule('video');
  if (!isQueueRunning) return;

  const nextIndex = queue.findIndex(t => t.status === 'waiting');
  if (nextIndex === -1) {
    isQueueRunning = false;
    const btnStart = document.getElementById('btn-start-queue');
    const btnPause = document.getElementById('btn-pause-queue');
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.classList.remove('busy');
    }
    if (btnPause) btnPause.disabled = true;
    if (generateBtnText) generateBtnText.textContent = '✦　Iniciar Fila de Geração　→';
    if (progressBar) progressBar.style.width = '100%';
    if (progressStatusText) progressStatusText.textContent = 'Fileira concluída com sucesso!';

    showToast('🎉 Todas as tarefas da fileira foram concluídas com sucesso!');
    return;
  }

  currentTaskIndex = nextIndex;
  const currentTask = queue[currentTaskIndex];
  currentTask.status = 'running';
  currentTask.progress = 5;
  renderQueue();

  const tier = document.getElementById('queue-gpu-tier')?.value || appSettings.gpuTier || 'Lite/Plus';
  showToast(`⚡ [${currentTask.name}] Iniciando no plano ${tier}...`);

  if (progressBar) progressBar.style.width = '10%';
  if (progressStatusText) progressStatusText.textContent = `[${currentTask.name}] Verificando popups e preparando...`;

  try {
    // 1. Limpa possíveis popups antes de começar
    await dismissPlatformPopups(false);

    // 2. Lê arquivos locais como base64
    if (progressStatusText) progressStatusText.textContent = `[${currentTask.name}] Lendo arquivos locais...`;
    const imgData = await window.electronAPI.readFileBase64(currentTask.imagePath);
    const vidData = await window.electronAPI.readFileBase64(currentTask.videoPath);

    currentTask.progress = 20;
    if (progressBar) progressBar.style.width = '25%';
    renderQueue();

    // 2.5. Garante que todos os nós do workflow de vídeo estão ativos (desfaz bypass indevido)
    await restoreVideoNodesActive(targetWv);

    // 3. Injeta arquivos no ComfyUI da RunningHub via fetch /upload/image
    if (progressStatusText) progressStatusText.textContent = `[${currentTask.name}] Injetando nós de vídeo e imagem no ComfyUI...`;
    showToast(`⬆️ Enviando foto e vídeo para o ComfyUI (Nós #12 e #99/#127)...`);

    const uploadScript = `
      (async () => {
        ${getComfyGraphFinderScript()}

        const ctx = findComfyContext();
        const comfyWin = ctx ? ctx.win : window;
        const comfyOrigin = (comfyWin.location && comfyWin.location.origin) ? comfyWin.location.origin : window.location.origin;

        const configuredApiKey = '${(appSettings.apiKey || '').replace(/'/g, "\\'")}';

        function base64ToBlob(base64, mimeType) {
          const byteChars = atob(base64);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          return new Blob([byteArray], { type: mimeType });
        }

        // Helper para extrair apikey ou token do armazenamento local
        function getCredentials() {
          let apiKey = configuredApiKey;
          let token = '';

          try {
            for (let i = 0; i < localStorage.length; i++) {
              const k = localStorage.key(i);
              const v = localStorage.getItem(k);
              if (!v) continue;

              if (!apiKey && (k.toLowerCase().includes('apikey') || k.toLowerCase().includes('api_key'))) {
                apiKey = v.replace(/["']/g, '').trim();
              }

              if (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth') || k.toLowerCase().includes('user') || (typeof v === 'string' && v.startsWith('eyJ'))) {
                try {
                  const obj = JSON.parse(v);
                  if (!apiKey && (obj.apiKey || obj.apikey || obj.api_key)) {
                    apiKey = obj.apiKey || obj.apikey || obj.api_key;
                  }
                  if (obj.token || obj.accessToken || obj.access_token) {
                    token = obj.token || obj.accessToken || obj.access_token;
                  }
                } catch (e) {
                  if (!token && typeof v === 'string') token = v;
                }
              }
            }
          } catch (e) {}

          return { apiKey, token };
        }

        const creds = getCredentials();

        async function uploadFileToRunningHub(blob, filename, fileType) {
          // 1. Tentar primeiro via ComfyUI API nativa do iframe ou window (sem precisar de API Key!)
          try {
            const apiObj = comfyWin.api || (comfyWin.app && comfyWin.app.api) || (comfyWin.comfyApp && comfyWin.comfyApp.api) || window.api || (window.app && window.app.api);
            if (apiObj && typeof apiObj.uploadFile === 'function') {
              const fileObj = new File([blob], filename, { type: blob.type || (fileType === 'video' ? 'video/mp4' : 'image/png') });
              const res = await apiObj.uploadFile(fileObj, '', { overwrite: true });
              if (res) {
                if (typeof res === 'string') return res;
                if (res.name) return res.name;
                if (res.fileName) return res.fileName;
                if (res.data && (res.data.name || res.data.fileName)) return res.data.name || res.data.fileName;
              }
            }
            if (apiObj && typeof apiObj.fetchApi === 'function') {
              const fd = new FormData();
              fd.append('image', blob, filename);
              fd.append('overwrite', 'true');
              fd.append('subfolder', '');
              fd.append('type', 'input');
              const resp = await apiObj.fetchApi('/upload/image', { method: 'POST', body: fd });
              if (resp && resp.ok) {
                const d = await resp.json();
                if (d && (d.name || d.fileName)) return d.name || d.fileName;
              }
            }
          } catch (e) {
            console.warn('[VELVY UPLOAD] ComfyUI API nativa erro:', e);
          }

          // 2. Tentar fetch direto para /upload/image na origem do ComfyUI
          try {
            const fdDirect = new FormData();
            fdDirect.append('image', blob, filename);
            fdDirect.append('overwrite', 'true');
            fdDirect.append('subfolder', '');
            fdDirect.append('type', 'input');
            const resp = await fetch(comfyOrigin + '/upload/image', {
              method: 'POST',
              body: fdDirect,
              credentials: 'include'
            });
            if (resp.ok) {
              const d = await resp.json();
              if (d && (d.name || d.fileName)) return d.name || d.fileName;
            }
          } catch (e) {}

          // 3. Fallback para endpoints de OpenAPI da RunningHub
          const endpoints = [
            'https://www.runninghub.ai/task/openapi/upload',
            '/task/openapi/upload',
            '/api/task/openapi/upload',
            'https://www.runninghub.cn/task/openapi/upload'
          ];

          let lastErrorMessage = '';
          for (const ep of endpoints) {
            try {
              const formData = new FormData();
              formData.append('file', blob, filename);
              formData.append('fileType', fileType);
              if (creds.apiKey) {
                formData.append('apiKey', creds.apiKey);
                formData.append('apikey', creds.apiKey);
              }

              const headers = {};
              if (creds.token) {
                headers['Authorization'] = creds.token.startsWith('Bearer ') ? creds.token : 'Bearer ' + creds.token;
                headers['token'] = creds.token;
              }
              if (creds.apiKey) {
                headers['apiKey'] = creds.apiKey;
                headers['apikey'] = creds.apiKey;
              }

              const res = await fetch(ep, {
                method: 'POST',
                body: formData,
                headers: headers,
                credentials: 'include'
              });

              if (res.ok) {
                const data = await res.json();
                console.log('[VELVY UPLOAD] Resposta RunningHub:', ep, data);
                if (data.code === 0 || data.success) {
                  const uploadedName = (data.data && (data.data.fileName || data.data.name)) || data.fileName || data.name;
                  if (uploadedName) return uploadedName;
                } else if (data.msg) {
                  lastErrorMessage = data.msg;
                }
              } else {
                lastErrorMessage = 'HTTP ' + res.status + ' em ' + ep;
              }
            } catch (err) {
              lastErrorMessage = err.message;
            }
          }

          throw new Error('Falha no upload do ' + fileType + ' para o ComfyUI / RunningHub: ' + (lastErrorMessage || 'Não foi possível enviar o arquivo'));
        }

        const imgBlob = base64ToBlob('${imgData.base64}', '${imgData.mimeType}');
        const vidBlob = base64ToBlob('${vidData.base64}', '${vidData.mimeType}');

        const serverImgName = await uploadFileToRunningHub(imgBlob, '${imgData.name}', 'image');
        const serverVidName = await uploadFileToRunningHub(vidBlob, '${vidData.name}', 'video');

        const graph = ctx ? ctx.graph : (comfyWin.app ? comfyWin.app.graph : null);
        let nodesUpdated = { imgNode: null, node12: false, reactivatedNodes: 0 };

        if (graph) {
          const allNodes = Array.isArray(graph._nodes) ? graph._nodes : (graph.nodes || []);

          // 1. REATIVA TODOS OS NÓS DO WORKFLOW (Desfaz qualquer bypass indevido)
          allNodes.forEach(n => {
            if (n && (n.mode === 4 || n.mode === 2)) {
              n.mode = 0; // 0 = ALWAYS (Ativo)
              nodesUpdated.reactivatedNodes++;
            }
          });
          const groups = graph._groups || graph.groups || [];
          groups.forEach(g => {
            g.rgthree_hasAnyActiveNode = true;
          });

          // Helper para atualizar thumbnail visual de imagem no nó
          function updateNodeImagePreview(node, filename) {
            if (!node || !filename) return;
            try {
              const apiObj = comfyWin.api || (comfyWin.app && comfyWin.app.api);
              let viewUrl = '';
              if (apiObj && typeof apiObj.apiURL === 'function') {
                viewUrl = apiObj.apiURL('/view?filename=' + encodeURIComponent(filename) + '&type=input&subfolder=');
              } else {
                viewUrl = '/view?filename=' + encodeURIComponent(filename) + '&type=input&subfolder=';
              }
              const img = new Image();
              img.onload = () => {
                node.imgs = [img];
                node.image = img;
                if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
                const canvasObj = comfyWin.LGraphCanvas && (comfyWin.LGraphCanvas.active_canvas || (comfyWin.app && comfyWin.app.canvas));
                if (canvasObj && typeof canvasObj.draw === 'function') {
                  try { canvasObj.draw(true, true); } catch (e) {}
                }
              };
              img.src = viewUrl;
            } catch (e) {}
          }

          // 2. Nó de Imagem de Referência: Nó #99 (V5) ou Nó #127 / #200 (V15/V18)
          const targetImgIds = [99, 127, 200];
          let nodeImg = null;
          for (const tid of targetImgIds) {
            const found = (typeof graph.getNodeById === 'function') ? graph.getNodeById(tid) : null;
            if (found) { nodeImg = found; break; }
          }
          if (!nodeImg) {
            nodeImg = allNodes.find(n => n.type === 'LoadImage' || 
              (n.title && (n.title.includes('ROSTO') || n.title.includes('IMAGEM') || n.title.includes('FRAME 0'))) ||
              (n.widgets && n.widgets.some(w => w.name === 'image')));
          }
          if (nodeImg) {
            nodeImg.mode = 0;
            if (nodeImg.widgets) {
              const wImg = nodeImg.widgets.find(w => w.name === 'image') || nodeImg.widgets[0];
              if (wImg) {
                wImg.value = serverImgName;
                if (typeof wImg.callback === 'function') {
                  try { wImg.callback(serverImgName); } catch (e) {}
                }
              }
            }
            if (Array.isArray(nodeImg.widgets_values)) {
              nodeImg.widgets_values[0] = serverImgName;
            }
            updateNodeImagePreview(nodeImg, serverImgName);
            nodesUpdated.imgNode = nodeImg.id;
          }

          // 3. Nó 12 (Vídeo Guia - VHS_LoadVideo)
          let node12 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(12) : null;
          if (!node12) {
            node12 = allNodes.find(n => n.type === 'VHS_LoadVideo' || 
              (n.title && (n.title.includes('LOAD VIDEO') || n.title.includes('VÍDEO GUIA') || n.title.includes('STEP1'))) ||
              (n.widgets && n.widgets.some(w => w.name === 'video')));
          }
          if (node12) {
            node12.mode = 0;
            if (node12.widgets) {
              const wVid = node12.widgets.find(w => w.name === 'video') || node12.widgets[0];
              if (wVid) {
                wVid.value = serverVidName;
                if (typeof wVid.callback === 'function') {
                  try { wVid.callback(serverVidName); } catch (e) {}
                }
              }
              const wPrev = node12.widgets.find(w => w.name === 'videopreview');
              if (wPrev) {
                if (!wPrev.value || typeof wPrev.value !== 'object') {
                  wPrev.value = { paused: false, hidden: false, params: {} };
                }
                if (!wPrev.value.params) wPrev.value.params = {};
                wPrev.value.params.filename = serverVidName;
                wPrev.value.params.type = 'input';
                wPrev.value.params.format = 'video/mp4';
              }
            }
            if (typeof node12.widgets_values === 'object' && !Array.isArray(node12.widgets_values) && node12.widgets_values !== null) {
              node12.widgets_values.video = serverVidName;
              if (node12.widgets_values.videopreview && node12.widgets_values.videopreview.params) {
                node12.widgets_values.videopreview.params.filename = serverVidName;
              }
            } else if (Array.isArray(node12.widgets_values)) {
              node12.widgets_values[0] = serverVidName;
            }
            nodesUpdated.node12 = true;
          }

          if (typeof graph.change === 'function') graph.change();
          if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
          const canvasObj = comfyWin.LGraphCanvas && (comfyWin.LGraphCanvas.active_canvas || (comfyWin.app && comfyWin.app.canvas));
          if (canvasObj && typeof canvasObj.draw === 'function') {
            try { canvasObj.draw(true, true); } catch (e) {}
          }
        }

        return { img: serverImgName, vid: serverVidName, nodesUpdated };
      })();
    `;

    const uploadRes = await targetWv.executeJavaScript(uploadScript);
    console.log('[VELVY STUDIO] Upload e nós configurados:', uploadRes);

    currentTask.progress = 40;
    if (progressBar) progressBar.style.width = '45%';
    renderQueue();

    // 4. Dispara o botão de execução (Run / Queue) correspondente ao plano escolhido
    if (progressStatusText) progressStatusText.textContent = `[${currentTask.name}] Disparando GPU tier ${tier}...`;
    showToast(`🚀 Disparando execução na GPU (${tier})...`);

    const triggerScript = `
      (() => {
        const tier = '${tier}';
        const logs = [];

        function dispatchFullClick(el) {
          if (!el) return;
          try {
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            if (typeof el.click === 'function') el.click();
          } catch (e) {
            try { el.click(); } catch (err) {}
          }
        }

        function findTierButton(doc, selectedTier) {
          if (!doc) return null;

          let tierKeyword = 'plus';
          if (selectedTier.includes('Standard')) tierKeyword = 'standard';
          if (selectedTier.includes('Ultra')) tierKeyword = 'ultra';

          const BLACKLIST = ['publicar', 'publish', 'assinar', 'subscribe', 'plano', 'plan', 'upgrade', 'benefício', 'beneficio', 'salvar', 'save', 'cancelar'];
          function isBad(t) {
            return BLACKLIST.some(w => t.includes(w));
          }

          // 1. Posição Geométrica Estrita na barra superior do RunningHub
          // A barra contém os botões em ordem estrita da esquerda para a direita:
          // [0] Lite/Standard (Esquerda - Verde)
          // [1] Lite/Plus (Centro - Pêssego/Laranja)
          // [2] Ultra 6000D (Direita - Vermelho/Laranja)
          const allButtons = Array.from(doc.querySelectorAll('button, [role="button"], .ant-btn'));
          const execButtons = allButtons.filter(b => {
            const t = (b.innerText || b.textContent || '').trim().toLowerCase();
            if (isBad(t)) return false;
            const rect = b.getBoundingClientRect();
            return (t === 'executar' || t.includes('executar')) && rect.top < 130 && rect.width > 20 && rect.height > 15;
          });

          execButtons.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

          // 2. Localizar badge correspondente ("Lite/Plus", "Lite/Standard", "Ultra") para confirmação
          const allElements = Array.from(doc.querySelectorAll('*'));
          const matchingBadge = allElements.find(el => {
            if (el.children.length > 2) return false;
            const t = (el.innerText || el.textContent || '').trim().toLowerCase();
            if (tierKeyword === 'plus' && t.includes('plus') && !t.includes('standard') && !t.includes('ultra')) return true;
            if (tierKeyword === 'standard' && t.includes('standard') && !t.includes('plus')) return true;
            if (tierKeyword === 'ultra' && (t.includes('ultra') || t.includes('6000d'))) return true;
            return false;
          });

          // Se achou o badge, seleciona o botão que está horizontalmente alinhado a ele (< 70px)
          if (matchingBadge && execButtons.length > 0) {
            const bRect = matchingBadge.getBoundingClientRect();
            const bCenter = bRect.left + bRect.width / 2;
            let closestBtn = null;
            let minDist = 9999;
            for (const btn of execButtons) {
              const r = btn.getBoundingClientRect();
              const c = r.left + r.width / 2;
              const dist = Math.abs(c - bCenter);
              if (dist < minDist) {
                minDist = dist;
                closestBtn = btn;
              }
            }
            if (closestBtn && minDist < 70) {
              return closestBtn;
            }
          }

          // Fallback por índice estrito:
          if (execButtons.length >= 3) {
            if (tierKeyword === 'standard') return execButtons[0];
            if (tierKeyword === 'plus') return execButtons[1];
            if (tierKeyword === 'ultra') return execButtons[2];
          } else if (execButtons.length === 2) {
            if (tierKeyword === 'standard') return execButtons[0];
            return execButtons[1];
          } else if (execButtons.length === 1) {
            return execButtons[0];
          }

          return null;
        }

        let target = findTierButton(document, tier);
        if (!target) {
          try {
            for (let i = 0; i < window.frames.length; i++) {
              target = findTierButton(window.frames[i].document, tier);
              if (target) break;
            }
          } catch (e) {}
        }
        if (!target) {
          const iframes = document.querySelectorAll('iframe');
          for (const f of iframes) {
            try {
              if (f.contentDocument) {
                target = findTierButton(f.contentDocument, tier);
                if (target) break;
              }
            } catch (e) {}
          }
        }

        if (target) {
          dispatchFullClick(target);
          return { clicked: true, tier: tier, text: target.innerText || target.tagName };
        }

        if (window.app && typeof window.app.queuePrompt === 'function') {
          window.app.queuePrompt(0);
          return { clicked: true, text: 'ComfyUI queuePrompt' };
        }

        return { clicked: false, tier: tier };
      })();
    `;

    // 3.5. Limpeza de estado e registro de baseline de vídeos antigos (CRÍTICO: nunca ler vídeos de execuções anteriores)
    await prepareCleanSlate(currentTask, targetWv);

    const triggerRes = await targetWv.executeJavaScript(triggerScript);
    console.log('[VELVY STUDIO] Disparo:', triggerRes);

    currentTask.progress = 55;
    if (progressBar) progressBar.style.width = '60%';
    renderQueue();
    if (progressStatusText) progressStatusText.textContent = `[${currentTask.name}] Gerando na nuvem... Monitorando Nó #122 / Nó #9...`;
    showToast(`⏳ Gerando IA na nuvem... Aguardando vídeo no nó de saída...`);

    // 5. Aguardar conclusão no Nó 122 / Nó 9 / Nó 117 Sleep / preview de vídeo
    const finalVideoUrl = await waitForVideoOutput(currentTask, targetWv);
    console.log('[VELVY STUDIO] URL capturada do vídeo:', (finalVideoUrl.length > 80 ? finalVideoUrl.substring(0, 80) + '...' : finalVideoUrl));

    currentTask.progress = 85;
    if (progressBar) progressBar.style.width = '85%';
    renderQueue();
    if (progressStatusText) progressStatusText.textContent = `[${currentTask.name}] Vídeo renderizado! Baixando...`;
    showToast(`📥 Vídeo gerado com sucesso! Baixando...`);

    // 6. Baixar o vídeo localmente via download nativo do Electron
    const cleanTaskName = currentTask.name.endsWith('.mp4') ? currentTask.name : `${currentTask.name}.mp4`;
    const downloadRes = await window.electronAPI.downloadVideo({
      url: finalVideoUrl,
      filename: `VELVY_${Date.now()}_${cleanTaskName}`,
      outputDir: appSettings.outputDir
    });

    console.log('[VELVY STUDIO] Download salvo:', downloadRes);
    currentTask.outputVideo = downloadRes.path;

    // Atualiza o player de preview imediatamente!
    updateVideoPreview(downloadRes.path, currentTask.name);

    // 7. Cancelar tarefa imediatamente para garantir ZERO CRÉDITOS gastos com o nó de sleep!
    if (progressStatusText) progressStatusText.textContent = `[${currentTask.name}] Salvando créditos: Cancelando Sleep Node...`;
    showToast(`🛑 Cancelando tarefa na nuvem (Trava Zero Créditos)...`);
    await triggerCloudTaskCancel(targetWv);

    currentTask.progress = 100;
    currentTask.status = 'done';
    if (progressBar) progressBar.style.width = '100%';
    if (progressStatusText) progressStatusText.textContent = `[${currentTask.name}] Concluído e salvo!`;
    renderQueue();
    showToast(`✅ [${currentTask.name}] Finalizado e salvo!`);

    // 8. Cooldown de 5 segundos antes de pegar o próximo vídeo
    if (isQueueRunning) {
      setTimeout(() => {
        processNextInQueue();
      }, 5000);
    }
  } catch (err) {
    console.error('[VELVY STUDIO] Erro no processamento da tarefa:', err);
    currentTask.status = 'error';
    if (progressStatusText) progressStatusText.textContent = `Erro em ${currentTask.name}: ${err.message}`;
    renderQueue();
    showToast(`❌ Erro em ${currentTask.name}: ${err.message}`);

    await triggerCloudTaskCancel(targetWv);

    if (isQueueRunning) {
      setTimeout(() => {
        processNextInQueue();
      }, 6000);
    }
  }
}

// 4. Limpeza de estado e registro de baseline de vídeos antigos (CRÍTICO: nunca ler vídeos de execuções anteriores)
async function prepareCleanSlate(task, explicitWv) {
  const targetWv = explicitWv || getWebviewForModule('video');
  try {
    const cleanScript = `
      (() => {
        const baseline = {
          filenames: [],
          urls: [],
          videoSrcs: [],
          startTime: Date.now()
        };

        function findGraph() {
          function check(w) {
            try {
              if (w && w.app && w.app.graph) return w.app.graph;
              if (w && w.graph && (w.graph._nodes || w.graph.getNodeById)) return w.graph;
              if (w && w.LGraphCanvas && w.LGraphCanvas.active_canvas && w.LGraphCanvas.active_canvas.graph) return w.LGraphCanvas.active_canvas.graph;
              if (w && w.comfyApp && w.comfyApp.graph) return w.comfyApp.graph;
            } catch (e) {}
            return null;
          }
          let g = check(window);
          if (g) return g;
          try {
            for (let i = 0; i < window.frames.length; i++) {
              g = check(window.frames[i]);
              if (g) return g;
            }
            const iframes = document.querySelectorAll('iframe');
            for (const f of iframes) {
              g = check(f.contentWindow);
              if (g) return g;
            }
          } catch (e) {}
          return null;
        }

        // 1. Grafo e nós de saída
        const graph = findGraph();
        if (graph) {
          const nodes = Array.isArray(graph._nodes) ? graph._nodes : (graph.nodes || []);
          const outNodes = nodes.filter(n => {
            const t = (n.type || '').toLowerCase();
            const title = (n.title || '').toLowerCase();
            return t.includes('videocombine') || t.includes('video') || title.includes('output') || title.includes('exportador') || title.includes('final') || title.includes('vídeo') || n.id === 9 || n.id === 122;
          });

          for (const node of outNodes) {
            if (node.widgets) {
              for (const w of node.widgets) {
                if (w.name === 'videopreview' && w.value) {
                  const p = w.value.params || w.value;
                  if (p.filename) baseline.filenames.push(p.filename);
                  if (p.url) baseline.urls.push(p.url);
                  if (p.cos_url || p.cosUrl) baseline.urls.push(p.cos_url || p.cosUrl);
                  
                  // CRUCIAL: Marcar e limpar widget antigo para não ser lido imediatamente
                  w._velvy_old_value = JSON.parse(JSON.stringify(w.value));
                  w._velvy_cleared_at = Date.now();
                  w.value = null;
                }
              }
            }
            if (node.video) {
              if (node.video.src) baseline.videoSrcs.push(node.video.src);
              if (node.video.currentSrc) baseline.videoSrcs.push(node.video.currentSrc);
              node.video.src = '';
            }
          }
        }

        // 2. Elementos de vídeo no DOM
        function scanAllVideos(doc) {
          if (!doc) return [];
          let list = Array.from(doc.querySelectorAll('video'));
          try {
            const iframes = doc.querySelectorAll('iframe');
            for (const f of iframes) {
              try {
                if (f.contentDocument) list = list.concat(scanAllVideos(f.contentDocument));
              } catch (e) {}
            }
          } catch (e) {}
          return list;
        }

        const allVideos = scanAllVideos(document);
        for (const v of allVideos) {
          const s = v.src || v.currentSrc;
          if (s) baseline.videoSrcs.push(s);
          v.setAttribute('data-velvy-stale', 'true');
        }

        // 3. Links na gaveta de tarefas
        const links = Array.from(document.querySelectorAll('a[download], a[href*=".mp4"]'));
        for (const a of links) {
          if (a.href) baseline.urls.push(a.href);
        }

        window.__VELVY_BASELINE = baseline;
        window.__VELVY_TASK_START = Date.now();
        return baseline;
      })();
    `;

    const baseline = await webview.executeJavaScript(cleanScript);
    console.log('[VELVY STUDIO] Limpeza pré-geração concluída. Vídeos antigos ignorados:', baseline);
    return baseline;
  } catch (err) {
    console.warn('[VELVY STUDIO] Falha ao preparar clean slate:', err);
    return null;
  }
}

function getDeepVideoExtractScript(options = {}) {
  const force = !!options.force;
  const minWaitPassed = options.minWaitPassed !== false;

  return `
    (async () => {
      const force = ${force};
      const minWaitPassed = ${minWaitPassed};
      const baseline = window.__VELVY_BASELINE || { filenames: [], urls: [], videoSrcs: [], startTime: 0 };

      // Helper para verificar se URL ou nome de arquivo é antigo da sessão anterior
      function isStale(val) {
        if (force) return false;
        if (!minWaitPassed) return true; // Nunca aceita antes do tempo mínimo
        if (!val) return true;
        const v = String(val).trim();
        if (baseline.filenames && baseline.filenames.some(fn => fn && v.includes(fn))) return true;
        if (baseline.urls && baseline.urls.includes(v)) return true;
        if (baseline.videoSrcs && baseline.videoSrcs.includes(v)) return true;
        return false;
      }

      // Helper para converter Blob URL ou URL HTTP para Data URL base64 dentro do webview
      async function toDataUrl(targetUrl) {
        if (!targetUrl) return null;
        if (targetUrl.startsWith('data:')) return targetUrl;
        try {
          const res = await fetch(targetUrl, { credentials: 'include' });
          if (!res.ok) return null;
          const blob = await res.blob();
          if (blob.size < 30000) return null; // Um vídeo mp4 real tem > 30KB
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch (e) {
          return null;
        }
      }

      function findGraph() {
        function check(w) {
          try {
            if (w && w.app && w.app.graph) return w.app.graph;
            if (w && w.graph && (w.graph._nodes || w.graph.getNodeById)) return w.graph;
            if (w && w.LGraphCanvas && w.LGraphCanvas.active_canvas && w.LGraphCanvas.active_canvas.graph) return w.LGraphCanvas.active_canvas.graph;
            if (w && w.comfyApp && w.comfyApp.graph) return w.comfyApp.graph;
          } catch (e) {}
          return null;
        }
        let g = check(window);
        if (g) return g;
        try {
          for (let i = 0; i < window.frames.length; i++) {
            g = check(window.frames[i]);
            if (g) return g;
          }
          const iframes = document.querySelectorAll('iframe');
          for (const f of iframes) {
            g = check(f.contentWindow);
            if (g) return g;
          }
        } catch (e) {}
        return null;
      }

      function scanAllVideos(doc) {
        if (!doc) return [];
        let list = Array.from(doc.querySelectorAll('video'));
        try {
          const iframes = doc.querySelectorAll('iframe');
          for (const f of iframes) {
            try {
              if (f.contentDocument) list = list.concat(scanAllVideos(f.contentDocument));
            } catch (e) {}
          }
        } catch (e) {}
        return list;
      }

      // 1. Checagem profunda no Grafo do ComfyUI (Nós de Saída #122, #9, etc)
      const graph = findGraph();
      if (graph) {
        const nodes = Array.isArray(graph._nodes) ? graph._nodes : (graph.nodes || []);
        const outNodes = nodes.filter(n => {
          const t = (n.type || '').toLowerCase();
          const title = (n.title || '').toLowerCase();
          return t.includes('videocombine') || t.includes('video') || title.includes('output') || title.includes('exportador') || title.includes('final') || title.includes('vídeo') || n.id === 9 || n.id === 122;
        });

        for (const node of outNodes) {
          if (node.widgets) {
            for (const w of node.widgets) {
              if (w.name === 'videopreview' && w.value) {
                const p = w.value.params || w.value;
                const candidateFilename = p.filename || '';
                const candidateUrl = p.cos_url || p.cosUrl || p.url || '';

                // Se for vídeo antigo conhecido, pula!
                if (!force && isStale(candidateFilename) && isStale(candidateUrl)) {
                  continue;
                }

                // Tentar obter via COS URL direta convertida para base64
                if (candidateUrl && candidateUrl.startsWith('http')) {
                  const dUrl = await toDataUrl(candidateUrl);
                  if (dUrl) return { url: dUrl, source: 'node_cos_data', filename: candidateFilename };
                  if (!isStale(candidateUrl)) return { url: candidateUrl, source: 'node_cos_url', filename: candidateFilename };
                }

                // Tentar montar URL /view do RunningHub e converter para base64 no webview
                if (candidateFilename) {
                  const sub = p.subfolder ? encodeURIComponent(p.subfolder) : '';
                  const format = p.format ? encodeURIComponent(p.format) : 'video/mp4';
                  const fn = encodeURIComponent(candidateFilename);
                  const typ = encodeURIComponent(p.type || 'output');
                  const viewUrl = 'https://www.runninghub.ai/view?filename=' + fn + '&subfolder=' + sub + '&type=' + typ + '&format=' + format;
                  
                  const dUrl = await toDataUrl(viewUrl);
                  if (dUrl) return { url: dUrl, source: 'node_filename_data', filename: candidateFilename };
                  if (!isStale(candidateFilename)) return { url: viewUrl, source: 'node_filename', filename: candidateFilename };
                }
              }
            }
          }

          // Vídeo embutido no objeto do nó
          if (node.video && (node.video.src || node.video.currentSrc)) {
            const vsrc = node.video.src || node.video.currentSrc;
            if (force || !isStale(vsrc)) {
              const dUrl = await toDataUrl(vsrc);
              if (dUrl) return { url: dUrl, source: 'node_video_blob' };
              if (!isStale(vsrc)) return { url: vsrc, source: 'node_video_src' };
            }
          }
        }
      }

      // 2. Checagem de elementos <video> renderizados no DOM
      const allVideos = scanAllVideos(document);
      for (const v of allVideos) {
        if (!force && v.getAttribute('data-velvy-stale') === 'true') continue;
        const src = v.src || v.currentSrc || (v.querySelector('source') ? v.querySelector('source').src : '');
        if (src) {
          if (force || !isStale(src)) {
            const dUrl = await toDataUrl(src);
            if (dUrl) return { url: dUrl, source: 'dom_video_blob' };
            if (!isStale(src)) return { url: src, source: 'dom_video_url' };
          }
        }
      }

      // 3. Checagem do Gatilho do Nó de Sleep / Barra de Progresso (ESPERA CRÉDITOS INFINITOS)
      // Se o nó de sleep já está rodando, o nó 122/9 COM CERTEZA terminou!
      const bodyText = (document.body ? document.body.innerText : '');
      const isSleepRunning = bodyText.includes('ESPERA CRÉDITOS INFINITOS') || 
                             bodyText.includes('CRÉDITOS INFINITOS') || 
                             bodyText.includes('Espera Créditos') ||
                             bodyText.includes('(1) 8') ||
                             bodyText.includes('(1) 9') ||
                             bodyText.includes('(1) 100%');

      if (isSleepRunning && (minWaitPassed || force)) {
        for (let i = allVideos.length - 1; i >= 0; i--) {
          const v = allVideos[i];
          const src = v.src || v.currentSrc;
          if (src) {
            const dUrl = await toDataUrl(src);
            if (dUrl) return { url: dUrl, source: 'sleep_trigger_data' };
            return { url: src, source: 'sleep_trigger_src' };
          }
        }
      }

      // 4. Checagem na gaveta de tarefas da RunningHub
      const dlLinks = Array.from(document.querySelectorAll('a[download], a[href*=".mp4"], a[href*="myqcloud.com"], [data-url*=".mp4"]'));
      for (const a of dlLinks) {
        const href = a.href || a.getAttribute('data-url');
        if (href && (force || !isStale(href))) {
          const dUrl = await toDataUrl(href);
          if (dUrl) return { url: dUrl, source: 'task_drawer_data' };
          return { url: href, source: 'task_drawer_link' };
        }
      }

      return null;
    })();
  `;
}

async function forceGrabCurrentVideo() {
  showToast('🔍 Buscando vídeo gerado no ComfyUI / RunningHub...');
  try {
    const curTask = (currentTaskIndex >= 0 && queue[currentTaskIndex]) ? queue[currentTaskIndex] : queue[0];
    const taskName = curTask ? curTask.name : `VIDEO_${Date.now()}`;

    // Forçar captura ignora filtro de antigos e busca vídeo atual
    const checkScript = getDeepVideoExtractScript({ minWaitPassed: true, force: true });
    const found = await webview.executeJavaScript(checkScript);

    if (found && found.url) {
      showToast(`📥 Vídeo capturado (${found.source})! Baixando...`);
      const cleanTaskName = taskName.endsWith('.mp4') ? taskName : `${taskName}.mp4`;
      const downloadRes = await window.electronAPI.downloadVideo({
        url: found.url,
        filename: `VELVY_${Date.now()}_${cleanTaskName}`,
        outputDir: appSettings.outputDir
      });

      console.log('[VELVY STUDIO] Captura manual salva:', downloadRes);
      updateVideoPreview(downloadRes.path, taskName);

      if (curTask) {
        curTask.outputVideo = downloadRes.path;
        curTask.status = 'done';
        curTask.progress = 100;
        renderQueue();
      }

      if (progressBar) progressBar.style.width = '100%';
      if (progressStatusText) progressStatusText.textContent = `[${taskName}] Vídeo capturado e salvo!`;

      showToast(`✅ Vídeo baixado e exibido no player!`);

      // Cancelar Sleep Node na nuvem para economizar créditos
      showToast('🛑 Cancelando Sleep Node na nuvem...');
      await triggerCloudTaskCancel();
      showToast('⚡ Trava Zero-Créditos executada com sucesso!');
    } else {
      showToast('⚠️ Nenhum vídeo pronto detectado. Verifique se o vídeo já apareceu no nó de saída.');
    }
  } catch (err) {
    console.error('[VELVY STUDIO] Erro na captura forçada:', err);
    showToast('❌ Erro na captura: ' + err.message);
  }
}

function waitForVideoOutput(task, explicitWv) {
  const wv = explicitWv || getWebviewForModule('video') || getActiveWebview();
  return new Promise((resolve, reject) => {
    let checkCount = 0;
    const taskStartTime = Date.now();
    const MIN_SAFE_WAIT_SECONDS = 35; // Vídeos com Wan/AnimateDiff demoram no mínimo 40-120s
    const maxChecks = 600; // 600 * 3s = 30 minutos max

    const interval = setInterval(async () => {
      if (!isQueueRunning) {
        clearInterval(interval);
        return reject(new Error('Fila cancelada pelo usuário'));
      }

      checkCount++;
      if (checkCount > maxChecks) {
        clearInterval(interval);
        return reject(new Error('Tempo limite de geração excedido (30 min)'));
      }

      const elapsedSeconds = Math.floor((Date.now() - taskStartTime) / 1000);
      const minWaitPassed = elapsedSeconds >= MIN_SAFE_WAIT_SECONDS;

      if (!minWaitPassed) {
        // Período de segurança: GPU gerando, ignorar completamente qualquer vídeo residual anterior
        task.progress = Math.min(75, 55 + Math.floor((elapsedSeconds / MIN_SAFE_WAIT_SECONDS) * 20));
        if (progressBar) progressBar.style.width = `${task.progress}%`;
        if (progressStatusText) {
          progressStatusText.textContent = `[${task.name}] Gerando na nuvem... (${elapsedSeconds}s / ${MIN_SAFE_WAIT_SECONDS}s trava anti-vídeo antigo)...`;
        }
        renderQueue();
        return; // Não checa vídeo ainda!
      }

      // Tempo de segurança concluído - agora podemos monitorar a saída real
      task.progress = Math.min(85, 75 + Math.floor(((elapsedSeconds - MIN_SAFE_WAIT_SECONDS) / 120) * 10));
      if (progressBar) progressBar.style.width = `${task.progress}%`;
      if (progressStatusText) {
        progressStatusText.textContent = `[${task.name}] Renderizando / Monitorando Nó #122 / #9 / Zero-Créditos (${elapsedSeconds}s decorridos)...`;
      }
      renderQueue();

      try {
        const checkScript = getDeepVideoExtractScript({ minWaitPassed: true, force: false });
        const found = await wv.executeJavaScript(checkScript);

        if (found && found.url) {
          console.log('[VELVY STUDIO] Novo vídeo detectado com sucesso!', found.source, (found.url.length > 80 ? found.url.substring(0, 80) + '...' : found.url));
          clearInterval(interval);
          resolve(found.url);
        }
      } catch (e) {
        console.warn('[VELVY STUDIO] Polling de vídeo:', e.message);
      }
    }, 3000);
  });
}

async function triggerCloudTaskCancel(explicitWv) {
  const targetWv = explicitWv || getActiveWebview();
  console.log(`[VELVY STUDIO] Disparando cancelamento na nuvem (Trava Zero Créditos) no webview [${targetWv ? targetWv.id : 'ativo'}]...`);
  try {
    const cancelScript = `
      (async () => {
        const logs = [];

        try { window.confirm = () => true; } catch (e) {}

        function dispatchFullClick(el) {
          if (!el) return;
          try {
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
            el.dispatchEvent(new PointerEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            if (typeof el.click === 'function') el.click();
          } catch (e) {
            try { el.click(); } catch (err) {}
          }
        }

        // 1. Interrompe API interna do ComfyUI
        ${getComfyGraphFinderScript()}
        const ctx = findComfyContext();
        if (ctx) {
          try {
            if (ctx.app && typeof ctx.app.interrupt === 'function') {
              ctx.app.interrupt();
              logs.push('ctx.app.interrupt');
            }
            if (ctx.win && typeof ctx.win.fetch === 'function') {
              ctx.win.fetch('/interrupt', { method: 'POST' }).catch(() => {});
              ctx.win.fetch('/api/interrupt', { method: 'POST' }).catch(() => {});
            }
          } catch (e) {}
        }

        // 2. Busca o botão/elemento exato "Cancelar" no DOM
        function findExactCancelButton() {
          const candidates = Array.from(document.querySelectorAll('button, a, span, div, p, [role="button"]'));
          const matches = [];

          for (const el of candidates) {
            // Ignorar se estiver dentro do modal de confirmação ou no botão de fechar (X) da gaveta
            if (el.closest('.ant-modal, .ant-modal-root, [role="dialog"], .ant-modal-confirm, .ant-drawer-close')) continue;

            const raw = (el.innerText || el.textContent || '').replace(/\\u00a0/g, ' ').trim().toLowerCase();
            // Texto curto para nunca selecionar containers pais da tarefa
            if (raw.length > 25) continue;

            if (raw === 'cancelar' || raw === 'cancel' || raw === 'interromper' || raw === 'parar' || raw.startsWith('cancelar')) {
              const r = el.getBoundingClientRect();
              // Não exige r.top <= window.innerHeight porque em filas longas (3ª ou 4ª tarefa) o card pode estar rolado para baixo!
              if (r.width > 0 && r.height > 0) {
                const clickable = el.closest('button, a, [role="button"]') || el;
                const inDrawer = Boolean(el.closest('.ant-drawer-body, .ant-drawer, [class*="drawer"], [class*="task"]'));
                matches.push({ el: clickable, text: raw, rect: r, inDrawer });
              }
            }
          }

          if (matches.length === 0) return null;

          // Prioriza o que estiver dentro da gaveta/card e o menor elemento em área
          matches.sort((a, b) => {
            if (a.inDrawer && !b.inDrawer) return -1;
            if (!a.inDrawer && b.inDrawer) return 1;
            return (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height);
          });

          const target = matches[0].el;
          try {
            target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
          } catch (e) {}

          return target;
        }

        let cancelBtn = findExactCancelButton();

        // Se NÃO estiver visível imediatamente, verifica se a gaveta já está aberta antes de clicar no handle
        if (!cancelBtn) {
          const isDrawerOpen = Boolean(document.querySelector('.ant-drawer-open, .ant-drawer.open') || 
            (document.querySelector('.ant-drawer-body') && document.querySelector('.ant-drawer-body').getBoundingClientRect().width > 50));

          if (!isDrawerOpen) {
            const allEls = Array.from(document.querySelectorAll('*'));
            const drawerHandles = allEls.filter(el => {
              const t = (el.innerText || el.textContent || '').replace(/\\u00a0/g, ' ').trim();
              if (!t.includes('Lista de tarefas')) return false;
              if (t.length > 30) return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && r.left >= (window.innerWidth * 0.60);
            });

            if (drawerHandles.length > 0) {
              const handle = drawerHandles.find(e => e.children.length === 0) || drawerHandles[0];
              dispatchFullClick(handle);
              logs.push('Abriu gaveta Lista de tarefas');
            }
          }

          for (let p = 0; p < 15; p++) {
            await new Promise(r => setTimeout(r, 200));
            cancelBtn = findExactCancelButton();
            if (cancelBtn) break;
          }
        }

        // 3. Clica no botão Cancelar da tarefa
        if (cancelBtn) {
          const btnDesc = cancelBtn.tagName + (cancelBtn.className ? '.' + cancelBtn.className.split(' ').join('.') : '');
          dispatchFullClick(cancelBtn);
          logs.push('Clicou Cancelar no card [' + btnDesc + ']');
        } else {
          logs.push('Aviso: Cancelar não encontrado no card');
        }

        // 4. Aguarda e confirma o modal Ant Design (polling de até 3.5 segundos)
        function confirmModal() {
          let confirmed = false;

          // Prioridade 1: Botão primário do Ant Design no modal (.ant-btn-primary)
          const primaryBtns = Array.from(document.querySelectorAll(
            '.ant-modal-confirm-btns .ant-btn-primary, .ant-modal-confirm .ant-btn-primary, .ant-modal-footer .ant-btn-primary, .ant-modal .ant-btn-primary, [role="dialog"] .ant-btn-primary, button.ant-btn-dangerous, .ant-modal-confirm-btns button:last-child'
          ));

          for (const btn of primaryBtns) {
            const r = btn.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              try { btn.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
              dispatchFullClick(btn);
              logs.push('Confirmou modal (.ant-btn-primary)');
              confirmed = true;
              return true;
            }
          }

          // Prioridade 2: Qualquer botão de modal com texto afirmativo (Determinar / Confirmar / OK / Sim)
          const modalBtns = Array.from(document.querySelectorAll('.ant-modal button, [role="dialog"] button, .ant-modal-confirm button, .ant-modal-content button'));
          for (const b of modalBtns) {
            const bt = (b.innerText || b.textContent || '').replace(/\\u00a0/g, ' ').trim().toLowerCase();
            if (bt.includes('cancel')) continue;
            if (bt === 'determinar' || bt === 'confirmar' || bt === 'ok' || bt === 'sim' || bt === 'yes' || bt === 'confirm' || bt.includes('determinar') || bt.includes('confirm')) {
              const r = b.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                try { b.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
                dispatchFullClick(b);
                logs.push('Confirmou modal (' + bt + ')');
                confirmed = true;
                return true;
              }
            }
          }

          return false;
        }

        // Polling de até 3.5 segundos para confirmar o modal assim que ele abrir
        let modalDone = false;
        for (let i = 0; i < 18; i++) {
          await new Promise(r => setTimeout(r, 200));
          if (confirmModal()) {
            modalDone = true;
            break;
          }
        }

        // Se após o polling o botão ainda existir, tenta mais um clique de resgate
        if (!modalDone && cancelBtn) {
          const reCheck = findExactCancelButton();
          if (reCheck) {
            dispatchFullClick(reCheck);
            for (let i = 0; i < 8; i++) {
              await new Promise(r => setTimeout(r, 200));
              if (confirmModal()) break;
            }
          }
        }

        // 5. Chamada de API direta com taskId se visível no card
        try {
          const bodyStr = (document.body ? (document.body.innerText + ' ' + document.body.innerHTML) : '');
          const m = bodyStr.match(/taskid[\\s:"]*(\\d{15,25})/i);
          if (m && m[1]) {
            const taskId = m[1];
            logs.push('taskId API: ' + taskId);
            const token = localStorage.getItem('Rh-Accesstoken') || localStorage.getItem('Rh-Comfy-Auth') || '';
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            fetch('/task/cancel', { method: 'POST', headers, body: JSON.stringify({ taskId }) }).catch(() => {});
            fetch('/api/task/cancel', { method: 'POST', headers, body: JSON.stringify({ taskId }) }).catch(() => {});
            fetch('/api/open/task/cancel', { method: 'POST', headers, body: JSON.stringify({ taskId }) }).catch(() => {});
          }
        } catch (e) {}

        return logs.join(' | ') || 'Comando enviado';
      })();
    `;

    const cancelRes = await (targetWv || webview).executeJavaScript(cancelScript);
    console.log('[VELVY STUDIO] Resultado do cancelamento:', cancelRes);
    showToast(`🛑 Cancelamento nuvem: ${cancelRes || 'Disparado'}`);
  } catch (err) {
    console.warn('[VELVY STUDIO] Erro ao disparar cancelamento:', err);
    showToast(`⚠️ Erro ao cancelar: ${err.message}`);
  }
}

// Platform Controls & Multi-Tab Webviews
function setupPlatformControls() {
  const btnBack = document.getElementById('wv-back');
  const btnForward = document.getElementById('wv-forward');
  const btnReload = document.getElementById('wv-reload');
  const urlBar = document.getElementById('wv-url-bar');
  const btnGo = document.getElementById('wv-go');
  const btnOpenWorkflow = document.getElementById('btn-open-workflow');
  const btnOpenWorkflowTab = document.getElementById('btn-open-workflow-tab');
  const btnInspect = document.getElementById('btn-inspect-webview');
  const btnProbe = document.getElementById('btn-probe-dom');

  const btnDismiss = document.getElementById('btn-dismiss-popups');
  const btnDismissTab = document.getElementById('btn-dismiss-popups-tab');

  // Alternador de Sub-Abas de Webview dentro de Plataforma Web
  const subtabBtns = document.querySelectorAll('.platform-subtab-btn');
  const activeWvBadge = document.getElementById('active-wv-badge');

  subtabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target-wv');
      if (!targetId) return;

      currentActiveWebviewId = targetId;
      subtabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.runninghub-webview').forEach(w => {
        w.classList.toggle('active', w.id === targetId);
      });

      const activeWv = document.getElementById(targetId);
      if (activeWv && urlBar) {
        try {
          urlBar.value = activeWv.getURL() || activeWv.getAttribute('src') || '';
        } catch (e) {
          urlBar.value = activeWv.getAttribute('src') || '';
        }
      }

      const title = btn.querySelector('.subtab-title')?.textContent || targetId;
      if (activeWvBadge) activeWvBadge.textContent = `Aba: ${title}`;
      showToast(`Aba ativa na plataforma: ${title}`);

      const module = btn.getAttribute('data-module');
      if (module && module !== 'video' && activeWv) {
        switchWorkflowMode(module, activeWv);
      }
    });
  });

  const handleDismiss = async () => {
    await dismissPlatformPopups(true);
  };

  if (btnDismiss) btnDismiss.addEventListener('click', handleDismiss);
  if (btnDismissTab) btnDismissTab.addEventListener('click', handleDismiss);

  if (btnBack) btnBack.addEventListener('click', () => webview.canGoBack() && webview.goBack());
  if (btnForward) btnForward.addEventListener('click', () => webview.canGoForward() && webview.goForward());
  if (btnReload) btnReload.addEventListener('click', () => webview.reload());
  if (btnGo) {
    btnGo.addEventListener('click', () => {
      let url = urlBar.value.trim();
      if (url && !url.startsWith('http')) url = 'https://' + url;
      if (url) webview.loadURL(url);
    });
  }

  const handleOpenWorkflow = () => {
    const isVideoTab = currentActiveWebviewId === 'wv-video';
    const targetUrl = isVideoTab ? (appSettings.workflowUrl || 'https://www.runninghub.ai/pt-br/workflow/2123548590904102913')
                                 : (appSettings.suiteWorkflowUrl || 'https://www.runninghub.ai/pt-br/workflow/2118471777898024961');
    if (targetUrl) {
      hasAutoDismissedModal = false;
      setWorkflowState('loading', 'Carregando Workflow... Aguarde');
      webview.loadURL(targetUrl);
      showToast('Abrindo workflow no ambiente seguro...');
    } else {
      showToast('⚠️ Configure a URL do Workflow na aba Configurações.');
    }
  };

  if (btnOpenWorkflow) btnOpenWorkflow.addEventListener('click', handleOpenWorkflow);
  if (btnOpenWorkflowTab) btnOpenWorkflowTab.addEventListener('click', handleOpenWorkflow);

  if (btnInspect) {
    btnInspect.addEventListener('click', () => {
      webview.openDevTools();
    });
  }

  if (btnProbe) {
    btnProbe.addEventListener('click', () => {
      runDOMProbe();
    });
  }

  // Desconectar da conta atual para fazer login em outra conta (Trocar Conta)
  const handleSwitchAccount = async () => {
    const confirmed = confirm('Deseja realmente desconectar da conta atual da RunningHub para entrar com outra conta?');
    if (!confirmed) return;

    showToast('🧹 Limpando cookies e sessão da RunningHub...');
    try {
      const res = await window.electronAPI.logoutRunningHub();
      if (res && res.success) {
        showToast('✅ Desconectado! Abrindo tela de login...');
        const loginUrl = 'https://www.runninghub.ai/pt-br/login';

        ['wv-video', 'wv-faceswap', 'wv-upscale', 'wv-clothes', 'wv-carousel'].forEach(id => {
          const wv = document.getElementById(id);
          if (wv) wv.loadURL(loginUrl);
        });

        // Alternar visualmente para a aba Plataforma Web para que o usuário faça o login
        const navPlatform = document.querySelector('[data-tab="platform"]');
        if (navPlatform) navPlatform.click();
      } else {
        showToast('❌ Erro ao desconectar: ' + ((res && res.error) || 'Falha desconhecida'));
      }
    } catch (err) {
      showToast('❌ Erro: ' + err.message);
    }
  };

  const btnSwitchAccount = document.getElementById('btn-switch-account');
  if (btnSwitchAccount) btnSwitchAccount.addEventListener('click', handleSwitchAccount);

  const btnSettingsSwitchAccount = document.getElementById('btn-settings-switch-account');
  if (btnSettingsSwitchAccount) btnSettingsSwitchAccount.addEventListener('click', handleSwitchAccount);

  // Controles do Frame Extractor (Aba Utilitária Externa)
  const wvFrameExtractor = document.getElementById('wv-frame-extractor');
  const btnFeBack = document.getElementById('fe-back');
  const btnFeForward = document.getElementById('fe-forward');
  const btnFeReload = document.getElementById('fe-reload');
  const btnFeReset = document.getElementById('fe-reset');
  const feUrlBar = document.getElementById('fe-url-bar');

  if (wvFrameExtractor) {
    if (btnFeBack) btnFeBack.addEventListener('click', () => { try { if (wvFrameExtractor.canGoBack()) wvFrameExtractor.goBack(); } catch(e){} });
    if (btnFeForward) btnFeForward.addEventListener('click', () => { try { if (wvFrameExtractor.canGoForward()) wvFrameExtractor.goForward(); } catch(e){} });
    if (btnFeReload) btnFeReload.addEventListener('click', () => { try { wvFrameExtractor.reload(); } catch(e){} });
    if (btnFeReset) btnFeReset.addEventListener('click', () => { try { wvFrameExtractor.loadURL('https://frame-extractor.com/en'); } catch(e){} });

    wvFrameExtractor.addEventListener('did-navigate', (e) => {
      if (feUrlBar && e.url) feUrlBar.value = e.url;
    });
    wvFrameExtractor.addEventListener('did-navigate-in-page', (e) => {
      if (feUrlBar && e.url) feUrlBar.value = e.url;
    });
  }
}

function setupWebviewEvents() {
  const urlBar = document.getElementById('wv-url-bar');
  const allWebviews = document.querySelectorAll('.runninghub-webview');

  allWebviews.forEach(wv => {
    const dot = document.getElementById(`dot-${wv.id}`);

    wv.addEventListener('did-start-loading', () => {
      if (dot) dot.classList.remove('online');
      if (wv.id === currentActiveWebviewId) {
        if (platformDot) platformDot.classList.remove('online');
        setWorkflowState('loading', 'Carregando Página...');
      }
    });

    wv.addEventListener('did-stop-loading', () => {
      if (dot) dot.classList.add('online');
      if (wv.id === currentActiveWebviewId) {
        if (platformDot) platformDot.classList.add('online');
        if (urlBar) {
          try { urlBar.value = wv.getURL(); } catch (e) {}
        }
        startDOMStateWatcher();
      }

      // Aplica o escudo de proteção visual para clientes (esconde nós e canvas)
      injectStealthShieldToWebview(wv);

      // Auto-calibra os interruptores de modo (Nó #61) exclusivamente para a função da aba
      const suiteModuleMap = {
        'wv-faceswap': 'face_swap',
        'wv-upscale': 'upscale',
        'wv-clothes': 'clothes_swap',
        'wv-carousel': 'carousel'
      };
      if (suiteModuleMap[wv.id]) {
        setTimeout(() => {
          switchWorkflowMode(suiteModuleMap[wv.id], wv);
        }, 3000);
      }
    });

    wv.addEventListener('did-navigate', (e) => {
      if (wv.id === currentActiveWebviewId && urlBar) {
        urlBar.value = e.url;
        startDOMStateWatcher();
      }
      injectStealthShieldToWebview(wv);
    });
  });
}

// Fechador Automático de Popups / Modais da Plataforma (Black Friday, Avisos, Banners)
async function dismissPlatformPopups(verbose = true) {
  try {
    const script = `
      (() => {
        let actions = [];

        // 1. Simular pressionamento da tecla Escape
        try {
          const escDown = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true });
          const escUp = new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true });
          document.dispatchEvent(escDown);
          window.dispatchEvent(escDown);
          document.dispatchEvent(escUp);
          window.dispatchEvent(escUp);
          actions.push('Disparado Escape');
        } catch (e) {}

        // 2. Seletores clássicos de frameworks de UI (Ant Design, Element Plus, etc.)
        const closeSelectors = [
          '.ant-modal-close',
          '.ant-modal-close-x',
          '.el-dialog__headerbtn',
          '.el-dialog__close',
          '[aria-label*="close" i]',
          '[aria-label*="fechar" i]',
          '.close-btn',
          '.btn-close',
          '.modal-close',
          '[class*="close-icon"]',
          '[class*="modal__close"]',
          '[class*="dialog__close"]',
          '.ant-notification-notice-close',
          '.ant-message-notice-close'
        ];

        for (const sel of closeSelectors) {
          const elements = document.querySelectorAll(sel);
          for (const el of elements) {
            if (el && el.offsetParent !== null) {
              el.click();
              actions.push('Clicado: ' + sel);
            }
          }
        }

        // 3. Varrer botões e caixas flutuantes com z-index alto ou modais
        const allFixed = Array.from(document.querySelectorAll('div, section, aside')).filter(el => {
          if (!el || el.offsetParent === null) return false;
          const s = window.getComputedStyle(el);
          return (s.position === 'fixed' || s.position === 'absolute') && parseInt(s.zIndex || 0) > 40;
        });

        for (const modal of allFixed) {
          const rect = modal.getBoundingClientRect();
          if (rect.width < 150 || rect.height < 100 || (rect.width > window.innerWidth * 0.95 && rect.height > window.innerHeight * 0.95)) {
            continue;
          }

          // Clicar no botão X no canto superior direito do modal
          const cornerX = rect.right - 24;
          const cornerY = rect.top + 24;
          if (cornerX > 0 && cornerY > 0) {
            const hit = document.elementFromPoint(cornerX, cornerY);
            if (hit && hit !== modal) {
              const btn = hit.closest('button, [role="button"], a, div, span, svg') || hit;
              btn.click();
              actions.push('Clicado botão canto: ' + btn.tagName);
            }
          }

          // Buscar elementos com 'X' ou '×' dentro do modal
          const textButtons = modal.querySelectorAll('button, div[role="button"], span, i');
          for (const btn of textButtons) {
            const txt = (btn.innerText || btn.textContent || '').trim();
            if (txt === '×' || txt === '✕' || txt === 'X' || txt === 'x') {
              btn.click();
              actions.push('Clicado botão texto X');
            }
          }
        }

        // 4. Máscara escura (backdrop) ativa
        const masks = document.querySelectorAll('.ant-modal-mask, .el-overlay, [class*="modal-mask"], [class*="dialog-mask"]');
        for (const mask of masks) {
          if (mask && mask.offsetParent !== null) {
            mask.click();
            actions.push('Clicado backdrop/máscara');
            setTimeout(() => {
              if (mask && mask.parentNode) {
                mask.style.display = 'none';
              }
            }, 500);
          }
        }

        return actions.length > 0 ? actions.join(' | ') : 'Nenhum popup detectado';
      })();
    `;

    const res = await webview.executeJavaScript(script);
    if (verbose) {
      console.log('[VELVY STUDIO] Fechamento de popup:', res);
      if (res && res !== 'Nenhum popup detectado') {
        showToast('🎯 Popup / Banner da plataforma fechado com sucesso!');
      }
    }
    return res;
  } catch (err) {
    console.warn('[VELVY STUDIO] Erro ao fechar popup:', err);
    return null;
  }
}

// Gerenciador de Estados do Workflow e Trava de Segurança da Fileira
let workflowConnectionState = 'offline';
let domStateWatcherInterval = null;
let hasAutoDismissedModal = false;
let hasDumpedProbe = false;

function setWorkflowState(state, text) {
  if (workflowConnectionState === state && workflowStatusText && workflowStatusText.textContent === text) {
    return;
  }
  workflowConnectionState = state;
  if (workflowStatusText) workflowStatusText.textContent = text;

  if (workflowStatusPill) {
    const indicator = workflowStatusPill.querySelector('.status-indicator');
    if (indicator) {
      indicator.className = 'status-indicator ' + state;
    }
  }

  if (platformDot) {
    platformDot.className = 'indicator-dot ' + (state === 'ready' ? 'online' : '');
  }

  const btnStart = document.getElementById('btn-start-queue');
  if (btnStart && !isQueueRunning) {
    if (state === 'ready') {
      btnStart.disabled = false;
      btnStart.classList.remove('locked');
      btnStart.title = 'Clique para iniciar a fila de geração';
      if (generateBtnText) generateBtnText.textContent = '✦　Iniciar Fila de Geração　→';
    } else {
      btnStart.disabled = true;
      btnStart.classList.add('locked');
      btnStart.title = 'Aguardando o workflow carregar por completo para liberar a fila.';
      if (generateBtnText) generateBtnText.textContent = 'Aguardando Workflow...';
    }
  }
}

// Observador Inteligente em Tempo Real (Detecção direta e resiliente do ComfyUI no DOM)
function startDOMStateWatcher() {
  if (domStateWatcherInterval) clearInterval(domStateWatcherInterval);

  domStateWatcherInterval = setInterval(async () => {
    if (!webview) return;

    try {
      const url = webview.getURL() || '';
      if (!url || url === 'about:blank') {
        setWorkflowState('offline', 'Desconectado: Abra a Plataforma Web');
        return;
      }

      // Se navegou para uma URL de workflow válida, persiste no appSettings
      if (url.includes('/workflow/') && url !== appSettings.workflowUrl) {
        appSettings.workflowUrl = url;
        window.electronAPI.saveSettings(appSettings).catch(() => {});
        const inputWf = document.getElementById('setting-workflow-url');
        if (inputWf) inputWf.value = url;
      }

      const watcherScript = `
        (() => {
          try {
            const currentUrl = window.location.href;
            const currentTitle = document.title || '';

            // 1. Checa botões de execução (Executar / Run / Queue / Ultra / Lite)
            function scanButtons(doc) {
              if (!doc) return [];
              return Array.from(doc.querySelectorAll('button, [role="button"], a, .rh-button, .run-btn, .ant-btn'));
            }

            let allButtons = scanButtons(document);
            try {
              for (let i = 0; i < window.frames.length; i++) {
                try { allButtons = allButtons.concat(scanButtons(window.frames[i].document)); } catch (e) {}
              }
              const iframes = document.querySelectorAll('iframe');
              for (const f of iframes) {
                try { allButtons = allButtons.concat(scanButtons(f.contentDocument)); } catch (e) {}
              }
            } catch (e) {}

            const runButtons = allButtons.filter(b => {
              const t = (b.innerText || b.textContent || '').toLowerCase().trim();
              const c = (b.className || '').toString().toLowerCase();
              return t.includes('executar') || t.includes('ultra') || t.includes('lite/') || 
                     t.includes('lite /') || t.includes('queue prompt') || 
                     c.includes('run-btn') || c.includes('rh-button');
            });

            const hasRunButtons = runButtons.length > 0;

            // 2. Checa canvas no documento principal e em iframes
            function scanCanvases(doc) {
              if (!doc) return [];
              return Array.from(doc.querySelectorAll('canvas'));
            }

            let allCanvases = scanCanvases(document);
            try {
              for (let i = 0; i < window.frames.length; i++) {
                try { allCanvases = allCanvases.concat(scanCanvases(window.frames[i].document)); } catch (e) {}
              }
              const iframes = document.querySelectorAll('iframe');
              for (const f of iframes) {
                try { allCanvases = allCanvases.concat(scanCanvases(f.contentDocument)); } catch (e) {}
              }
            } catch (e) {}

            const hasCanvas = allCanvases.length > 0 || !!document.querySelector('.litegraph, #graph-canvas, .graph-canvas');

            // 3. Checa nós ComfyUI via instâncias globais
            let nodeCount = 0;
            function checkGraph(w) {
              try {
                if (!w) return 0;
                if (w.app && w.app.graph && w.app.graph._nodes) {
                  return Array.isArray(w.app.graph._nodes) ? w.app.graph._nodes.length : Object.keys(w.app.graph._nodes).length;
                }
                if (w.graph && w.graph._nodes) {
                  return Array.isArray(w.graph._nodes) ? w.graph._nodes.length : Object.keys(w.graph._nodes).length;
                }
                if (w.LGraphCanvas && w.LGraphCanvas.active_canvas && w.LGraphCanvas.active_canvas.graph && w.LGraphCanvas.active_canvas.graph._nodes) {
                  return w.LGraphCanvas.active_canvas.graph._nodes.length;
                }
              } catch (e) {}
              return 0;
            }

            nodeCount = checkGraph(window);
            if (nodeCount === 0) {
              try {
                for (let i = 0; i < window.frames.length; i++) {
                  try {
                    nodeCount = checkGraph(window.frames[i]);
                    if (nodeCount > 0) break;
                  } catch (e) {}
                }
              } catch (e) {}
            }

            // 4. Checa marcadores visuais do workflow
            const bodyText = document.body ? document.body.innerText : '';
            const hasWorkflowMarkers = currentTitle.includes('VELVYJUTSU') || 
                                       currentTitle.includes('DANÇA') || 
                                       currentTitle.includes('POV') || 
                                       bodyText.includes('VELVYJUTSU') || 
                                       bodyText.includes('Save manually') || 
                                       bodyText.includes('Salvar') || 
                                       bodyText.includes('Nodes 2.0') || 
                                       bodyText.includes('STEP1:') || 
                                       bodyText.includes('VIDEO OUTPUT');

            // 5. Checa se é página de workflow
            const isWorkflowPage = currentUrl.includes('/workflow/') || hasWorkflowMarkers || hasCanvas;

            // 6. Checa login
            const isLoginPage = (currentUrl.includes('/login') || currentUrl.includes('/signin')) && !hasRunButtons;

            // 7. Checa popups ou banners bloqueantes
            const activeModals = Array.from(document.querySelectorAll('.ant-modal-mask, .el-overlay, [class*="modal-mask"]')).filter(m => {
              if (!m || m.offsetParent === null) return false;
              const s = window.getComputedStyle(m);
              return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
            });
            const hasModal = activeModals.length > 0;

            return {
              url: currentUrl,
              title: currentTitle,
              isLoggedIn: !isLoginPage,
              isWorkflowPage,
              hasRunButtons,
              runButtonCount: runButtons.length,
              hasCanvas,
              canvasCount: allCanvases.length,
              nodeCount,
              hasWorkflowMarkers,
              hasModal
            };
          } catch (watcherErr) {
            return null;
          }
        })();
      `;

      const info = await webview.executeJavaScript(watcherScript);
      if (!info) return;

      if (!info.isLoggedIn) {
        hasAutoDismissedModal = false;
        setWorkflowState('offline', 'Desconectado: Faça Login na Conta');
      } else if (info.isWorkflowPage) {
        // Se os botões de execução existem OU o canvas/nós estão montados na página de workflow, está PRONTO
        const isReady = info.hasRunButtons || (info.hasCanvas && info.hasWorkflowMarkers) || info.nodeCount > 0;

        if (isReady) {
          if (info.hasModal || !hasAutoDismissedModal) {
            await dismissPlatformPopups(false);
            hasAutoDismissedModal = true;
          }

          if (workflowConnectionState !== 'ready') {
            showToast('⚡ Workflow pronto para uso! Fila liberada.');
          }
          setWorkflowState('ready', 'Workflow Pronto para Uso');

          if (!hasDumpedProbe) {
            hasDumpedProbe = true;
            setTimeout(() => runDOMProbe().catch(() => {}), 1000);
          }
        } else {
          hasAutoDismissedModal = false;
          setWorkflowState('loading', 'Carregando Workflow... Aguarde');
          if (info.hasModal) {
            dismissPlatformPopups(false);
          }
        }
      } else {
        hasAutoDismissedModal = false;
        setWorkflowState('loading', 'Conectado: Abra seu Workflow');
      }
    } catch (err) {
      // Ignora transições rápidas de navegação
    }
  }, 1200);
}

// Trigger Cancel on Platform
async function triggerPlatformCancel() {
  try {
    const script = `
      (() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"], a'));
        const cancelBtn = buttons.find(b => {
          const t = (b.innerText || b.getAttribute('title') || '').toLowerCase();
          return t.includes('interrupt') || t.includes('cancel') || t.includes('cancelar') || t.includes('parar');
        });
        if (cancelBtn) {
          cancelBtn.click();
          return 'Botão de Cancelar clicado com sucesso!';
        }
        return 'Botão de Cancelar não encontrado no DOM.';
      })();
    `;
    const res = await webview.executeJavaScript(script);
    console.log('Cancel probe result:', res);
  } catch (e) {
    console.error('Error triggering cancel:', e);
  }
}

// DOM Probe
function setupInspector() {
  const btnProbe = document.getElementById('btn-run-full-probe');
  if (btnProbe) btnProbe.addEventListener('click', runDOMProbe);
}

async function runDOMProbe() {
  const logOutput = document.getElementById('dom-log-output');
  if (!logOutput) return;

  logOutput.textContent = 'Fechando possíveis modais e analisando DOM, Tokens e ComfyUI da página aberta no Webview...';
  await dismissPlatformPopups(false);

  try {
    const probeScript = `
      (() => {
        const result = {
          url: window.location.href,
          title: document.title,
          tokensFound: [],
          comfyGlobals: {},
          graphNodesSummary: [],
          fileInputs: [],
          buttons: [],
          videos: []
        };

        // 1. Tokens de Autenticação no LocalStorage & SessionStorage
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            const v = localStorage.getItem(k);
            if (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth') || k.toLowerCase().includes('user') || (typeof v === 'string' && v.startsWith('eyJ'))) {
              result.tokensFound.push({ storage: 'localStorage', key: k, preview: (v || '').substring(0, 35) + '...' });
            }
          }
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            const v = sessionStorage.getItem(k);
            if (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth')) {
              result.tokensFound.push({ storage: 'sessionStorage', key: k, preview: (v || '').substring(0, 35) + '...' });
            }
          }
        } catch (e) {
          result.tokensError = e.message;
        }

        // 2. Objetos ComfyUI Globais
        result.comfyGlobals = {
          hasApp: typeof window.app !== 'undefined',
          hasApi: typeof window.api !== 'undefined',
          hasComfyApp: typeof window.comfyApp !== 'undefined',
          hasGraph: typeof window.graph !== 'undefined',
          hasLGraphCanvas: typeof window.LGraphCanvas !== 'undefined',
          apiBase: window.api ? window.api.api_base : (window.app && window.app.api ? window.app.api.api_base : null),
          appMethods: window.app ? Object.keys(window.app).filter(k => typeof window.app[k] === 'function') : [],
          apiMethods: window.api ? Object.keys(window.api).filter(k => typeof window.api[k] === 'function') : []
        };

        // 3. Nós ComfyUI (especialmente nós de imagem e vídeo)
        function scanGraph(w) {
          try {
            if (w.app && w.app.graph) return w.app.graph;
            if (w.graph && w.graph._nodes) return w.graph;
            if (w.LGraphCanvas && w.LGraphCanvas.active_canvas && w.LGraphCanvas.active_canvas.graph) return w.LGraphCanvas.active_canvas.graph;
          } catch (e) {}
          return null;
        }

        let g = scanGraph(window);
        if (!g) {
          try {
            for (let i = 0; i < window.frames.length; i++) {
              g = scanGraph(window.frames[i]);
              if (g) break;
            }
          } catch (e) {}
        }

        if (g && g._nodes) {
          result.graphNodesSummary = g._nodes.map(n => ({
            id: n.id,
            type: n.type,
            title: n.title,
            widgets: (n.widgets || []).map(w => ({ 
              name: w.name, 
              type: w.type, 
              val: w.value,
              hasCallback: typeof w.callback === 'function',
              callbackCode: w.callback ? w.callback.toString().substring(0, 400) : null
            })),
            onDragDropCode: n.onDragDrop ? n.onDragDrop.toString().substring(0, 400) : null
          }));

          const node12 = g.getNodeById ? g.getNodeById(12) : g._nodes.find(n => n.id === 12);
          if (node12) {
            result.node12 = {
              title: node12.title,
              type: node12.type,
              widgets: (node12.widgets || []).map(w => ({
                name: w.name,
                type: w.type,
                value: w.value,
                callbackCode: w.callback ? w.callback.toString() : null
              }))
            };
          }

          const node99 = g.getNodeById ? g.getNodeById(99) : g._nodes.find(n => n.id === 99);
          if (node99) {
            result.node99 = {
              title: node99.title,
              type: node99.type,
              widgets: (node99.widgets || []).map(w => ({
                name: w.name,
                type: w.type,
                value: w.value,
                callbackCode: w.callback ? w.callback.toString() : null
              }))
            };
          }
        }

        // 4. File Inputs
        document.querySelectorAll('input[type="file"]').forEach((el, idx) => {
          result.fileInputs.push({
            index: idx,
            id: el.id,
            name: el.name,
            accept: el.accept,
            className: el.className
          });
        });

        // 5. Botões
        document.querySelectorAll('button, [role="button"]').forEach((el, idx) => {
          const text = (el.innerText || el.getAttribute('title') || '').trim();
          if (text) {
            const lower = text.toLowerCase();
            if (lower.includes('queue') || lower.includes('run') || lower.includes('executar') || 
                lower.includes('interrupt') || lower.includes('cancel') || lower.includes('gerar') ||
                lower.includes('upload') || lower.includes('carregar')) {
              result.buttons.push({
                index: idx,
                text: text,
                className: el.className,
                tagName: el.tagName
              });
            }
          }
        });

        // 6. Vídeos
        document.querySelectorAll('video').forEach((el, idx) => {
          result.videos.push({
            index: idx,
            src: el.src || el.currentSrc,
            id: el.id
          });
        });

        return result;
      })();
    `;

    const data = await webview.executeJavaScript(probeScript);
    logOutput.textContent = JSON.stringify(data, null, 2);
    if (window.electronAPI && typeof window.electronAPI.saveProbeDump === 'function') {
      await window.electronAPI.saveProbeDump(data);
    }

    // Update metrics
    const mFiles = document.getElementById('metric-file-inputs');
    if (mFiles) mFiles.textContent = data.fileInputs.length;
    
    const cancelBtn = data.buttons.find(b => b.text.toLowerCase().includes('cancel') || b.text.toLowerCase().includes('interrupt'));
    const mCancel = document.getElementById('metric-cancel-btn');
    if (mCancel) mCancel.textContent = cancelBtn ? `Detectado: "${cancelBtn.text}"` : 'Não Detectado';

    const queueBtn = data.buttons.find(b => b.text.toLowerCase().includes('queue') || b.text.toLowerCase().includes('run'));
    const mQueue = document.getElementById('metric-queue-btn');
    if (mQueue) mQueue.textContent = queueBtn ? `Detectado: "${queueBtn.text}"` : 'Não Detectado';

    const mVideo = document.getElementById('metric-video-out');
    if (mVideo) mVideo.textContent = data.videos.length > 0 ? `${data.videos.length} vídeos no DOM` : 'Aguardando Geração';

    showToast('🔬 Análise do DOM concluída!');
  } catch (err) {
    logOutput.textContent = 'Erro ao executar script no Webview:\n' + err.message;
    showToast('❌ Erro ao analisar o DOM.');
  }
}

// Settings
function setupSettings() {
  const btnSave = document.getElementById('btn-save-settings');
  const btnBrowseDir = document.getElementById('btn-browse-output-dir');

  if (btnBrowseDir) {
    btnBrowseDir.addEventListener('click', async () => {
      const dir = await window.electronAPI.openDirectoryDialog();
      if (dir) {
        document.getElementById('setting-output-dir').value = dir;
      }
    });
  }

  if (btnSave) {
    btnSave.addEventListener('click', async () => {
      appSettings.workflowUrl = document.getElementById('setting-workflow-url').value.trim();
      appSettings.suiteWorkflowUrl = document.getElementById('setting-suite-workflow-url')?.value.trim() || 'https://www.runninghub.ai/pt-br/workflow/2118471777898024961';
      appSettings.apiKey = document.getElementById('setting-api-key')?.value.trim() || '';
      appSettings.gpuTier = document.getElementById('setting-gpu-tier')?.value || 'Lite/Plus';
      appSettings.initDelaySeconds = parseInt(document.getElementById('setting-init-delay').value) || 270;
      appSettings.outputDir = document.getElementById('setting-output-dir').value.trim();
      appSettings.autoDownload = document.getElementById('setting-auto-download').checked;

      // Atualiza URL nos webviews
      if (appSettings.workflowUrl) {
        const wvVid = document.getElementById('wv-video');
        if (wvVid && wvVid.getAttribute('src') !== appSettings.workflowUrl) wvVid.loadURL(appSettings.workflowUrl);
      }
      if (appSettings.suiteWorkflowUrl) {
        ['wv-faceswap', 'wv-upscale', 'wv-clothes', 'wv-carousel'].forEach(id => {
          const wv = document.getElementById(id);
          if (wv && wv.getAttribute('src') !== appSettings.suiteWorkflowUrl) wv.loadURL(appSettings.suiteWorkflowUrl);
        });
      }

      const queueTierEl = document.getElementById('queue-gpu-tier');
      if (queueTierEl) queueTierEl.value = appSettings.gpuTier;

      const ok = await window.electronAPI.saveSettings(appSettings);
      if (ok) {
        showToast('💾 Configurações salvas com sucesso!');
      } else {
        showToast('❌ Erro ao salvar configurações.');
      }
    });
  }

  const queueTierEl = document.getElementById('queue-gpu-tier');
  if (queueTierEl) {
    queueTierEl.addEventListener('change', () => {
      appSettings.gpuTier = queueTierEl.value;
      const setTierEl = document.getElementById('setting-gpu-tier');
      if (setTierEl) setTierEl.value = queueTierEl.value;
      window.electronAPI.saveSettings(appSettings);
      showToast(`⚡ GPU Tier: ${queueTierEl.value}`);
    });
  }
}

function applySettingsToUI() {
  if (appSettings.workflowUrl) {
    const el = document.getElementById('setting-workflow-url');
    if (el) el.value = appSettings.workflowUrl;
  }
  if (appSettings.suiteWorkflowUrl) {
    const el = document.getElementById('setting-suite-workflow-url');
    if (el) el.value = appSettings.suiteWorkflowUrl;
  } else {
    // Default URL da Suíte informada por dj
    appSettings.suiteWorkflowUrl = 'https://www.runninghub.ai/pt-br/workflow/2118471777898024961';
    const el = document.getElementById('setting-suite-workflow-url');
    if (el) el.value = appSettings.suiteWorkflowUrl;
  }
  if (appSettings.apiKey) {
    const el = document.getElementById('setting-api-key');
    if (el) el.value = appSettings.apiKey;
  }
  if (appSettings.gpuTier) {
    const setTier = document.getElementById('setting-gpu-tier');
    if (setTier) setTier.value = appSettings.gpuTier;
    const qTier = document.getElementById('queue-gpu-tier');
    if (qTier) qTier.value = appSettings.gpuTier;
  }
  if (appSettings.initDelaySeconds) {
    const el = document.getElementById('setting-init-delay');
    if (el) el.value = appSettings.initDelaySeconds;
  }
  if (appSettings.outputDir) {
    const el = document.getElementById('setting-output-dir');
    if (el) el.value = appSettings.outputDir;
  }
  if (typeof appSettings.autoDownload !== 'undefined') {
    const el = document.getElementById('setting-auto-download');
    if (el) el.checked = appSettings.autoDownload;
  }
}

// =========================================================================
// VELVY SUITE 4-IN-1: COMBO WORKFLOW ENGINE & AUTOMATIC MODE SWITCHER
// =========================================================================

// Helper compartilhado para localizar o Grafo ComfyUI em qualquer nível (window, frames ou iframes)
function getComfyGraphFinderScript() {
  return `
    function findComfyContext() {
      function checkW(w) {
        try {
          if (!w) return null;
          if (w.app && w.app.graph) return { win: w, graph: w.app.graph, app: w.app };
          if (w.graph && (w.graph._nodes || w.graph.getNodeById)) return { win: w, graph: w.graph, app: w.app || w.comfyApp };
          if (w.LGraphCanvas && w.LGraphCanvas.active_canvas && w.LGraphCanvas.active_canvas.graph) {
            return { win: w, graph: w.LGraphCanvas.active_canvas.graph, app: w.app };
          }
          if (w.comfyApp && w.comfyApp.graph) return { win: w, graph: w.comfyApp.graph, app: w.comfyApp };
        } catch (e) {}
        return null;
      }
      let c = checkW(window);
      if (c) return c;
      try {
        for (let i = 0; i < window.frames.length; i++) {
          try {
            c = checkW(window.frames[i]);
            if (c) return c;
          } catch (e) {}
        }
      } catch (e) {}
      try {
        const iframes = document.querySelectorAll('iframe');
        for (const f of iframes) {
          try {
            c = checkW(f.contentWindow);
            if (c) return c;
          } catch (e) {}
        }
      } catch (e) {}
      return null;
    }

    function getGraphInstance() {
      const ctx = findComfyContext();
      return ctx ? ctx.graph : null;
    }
  `;
}

// Reativa todos os nós do workflow de vídeo caso tenham sido acidentalmente mutados/bypasados
async function restoreVideoNodesActive(explicitWv) {
  const wv = explicitWv || getWebviewForModule('video');
  if (!wv) return { restored: 0 };
  const restoreScript = `
    (() => {
      ${getComfyGraphFinderScript()}
      const ctx = findComfyContext();
      if (!ctx || !ctx.graph) return { restored: 0 };
      const graph = ctx.graph;
      const win = ctx.win || window;
      const allNodes = Array.isArray(graph._nodes) ? graph._nodes : (graph.nodes || []);
      let count = 0;
      allNodes.forEach(n => {
        if (n && (n.mode === 4 || n.mode === 2)) {
          n.mode = 0; // 0 = ALWAYS (Ativo)
          count++;
        }
      });
      const groups = graph._groups || graph.groups || [];
      groups.forEach(g => {
        g.rgthree_hasAnyActiveNode = true;
      });
      if (typeof graph.change === 'function') graph.change();
      if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
      const canvasObj = win.LGraphCanvas && (win.LGraphCanvas.active_canvas || (win.app && win.app.canvas));
      if (canvasObj && typeof canvasObj.draw === 'function') {
        try { canvasObj.draw(true, true); } catch (e) {}
      }
      return { restored: count };
    })();
  `;
  try {
    const res = await wv.executeJavaScript(restoreScript);
    if (res && res.restored > 0) {
      console.log(`[VELVY STUDIO] ${res.restored} nós do Video Engine foram reativados com sucesso!`);
      showToast(`🟢 ${res.restored} nós do workflow de vídeo reativados!`);
    }
    return res;
  } catch (e) {
    console.warn('[VELVY STUDIO] Erro ao reativar nós do vídeo:', e);
    return { restored: 0 };
  }
}

// Comuta os modos do workflow no ComfyUI da RunningHub:
// Ativa o grupo correspondente (mode = 0) e desativa todos os outros grupos (mode = 4)
async function switchWorkflowMode(targetMode, explicitWv, retryCount = 0) {
  if (targetMode === 'video') {
    // Vídeo Engine é um workflow autônomo, não faz parte da suíte 4-em-1.
    // NUNCA bypassar ou alterar modos de nós no workflow de vídeo!
    const targetWv = explicitWv || getWebviewForModule('video');
    if (targetWv) restoreVideoNodesActive(targetWv);
    return { success: true, reason: 'Video engine is standalone' };
  }

  const targetWv = explicitWv || getWebviewForModule(targetMode);
  if (!targetWv) return { success: false, reason: 'Webview não inicializado' };

  console.log(`[VELVY STUDIO] Comutando modo do workflow para: ${targetMode} no webview [${targetWv.id}] (tentativa ${retryCount + 1})...`);
  const switchScript = `
    (() => {
      ${getComfyGraphFinderScript()}

      const ctx = findComfyContext();
      if (!ctx || !ctx.graph) return { success: false, reason: 'Grafo ComfyUI não localizado' };

      const graph = ctx.graph;
      const win = ctx.win || window;
      const groups = graph._groups || graph.groups || [];
      const allNodes = Array.isArray(graph._nodes) ? graph._nodes : (graph.nodes || []);

      function isModuleMatch(title, mode) {
        const t = (title || '').toUpperCase();
        if (mode === 'face_swap' || mode === 'faceswap') {
          return t.includes('FACE SWAP') || t.includes('KLEIN');
        }
        if (mode === 'upscale') {
          return t.includes('ULTRA-DETALHAMENTO') || t.includes('4K CINEMA') || t.includes('SEEDVR2');
        }
        if (mode === 'clothes_swap' || mode === 'clothes') {
          return t.includes('TROCADOR DE ROUPA') || (t.includes('ROUPA') && !t.includes('SWAP'));
        }
        if (mode === 'carousel') {
          return t.includes('CARROSSEL');
        }
        if (mode === 'video') {
          return t.includes('VIDEO') || t.includes('STEP1') || t.includes('EXPORTADOR');
        }
        return false;
      }

      // 1. Configurar nós precisamente por ID mapeado para evitar sobreposição geométrica de bounding box
      const MODULE_NODES = {
        face_swap: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 35, 36, 44, 45, 46, 47, 48, 54, 55, 56, 239, 240, 369, 370, 371],
        clothes_swap: [339, 340, 341, 342, 343, 344, 345, 346, 347, 348, 349, 350, 351, 352, 353, 354, 355, 356, 357, 358, 359, 360, 361, 362, 363, 364, 365],
        carousel: [386, 387, 389, 390, 391, 392, 393, 394, 395, 396, 397, 398, 399, 400, 401, 402, 403, 404, 405],
        upscale: [241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 319, 320, 323, 325, 338, 366, 367, 368]
      };

      const normalizedTarget = ('${targetMode}' === 'faceswap') ? 'face_swap' : ('${targetMode}' === 'clothes') ? 'clothes_swap' : '${targetMode}';
      const results = [];

      // Aplica modos nós a nós
      Object.keys(MODULE_NODES).forEach(modKey => {
        const isTarget = (modKey === normalizedTarget);
        const modeVal = isTarget ? 0 : 4; // 0 = ALWAYS (Ativo), 4 = BYPASS (Ignorado)
        const nodeIds = MODULE_NODES[modKey];

        let affected = 0;
        nodeIds.forEach(id => {
          const n = (typeof graph.getNodeById === 'function') ? graph.getNodeById(id) : allNodes.find(x => x.id === id);
          if (n) {
            n.mode = modeVal;
            affected++;
          }
        });
        results.push({ module: modKey, active: isTarget, nodes: affected });
      });

      // Sincroniza flag rgthree_hasAnyActiveNode nos grupos
      groups.forEach(g => {
        const shouldBeActive = isModuleMatch(g.title, '${targetMode}');
        g.rgthree_hasAnyActiveNode = shouldBeActive;
      });

      // 2. Sincronizar visualmente os interruptores do Nó #61 (Fast Groups Bypasser - ON/OFF do rgthree)
      const n61 = (typeof graph.getNodeById === 'function' ? graph.getNodeById(61) : null) || 
                  allNodes.find(n => n.id === 61 || (n.type && n.type.includes('Fast Groups Bypasser')));

      let n61Updated = false;
      if (n61 && n61.widgets) {
        n61.widgets.forEach(w => {
          const wLabel = (w.label || w.name || (w.group && w.group.title) || '') + '';
          const shouldEnable = isModuleMatch(wLabel, '${targetMode}');

          // Atualiza estado visual do widget rgthree
          w.toggled = shouldEnable;
          if (w.value && typeof w.value === 'object') {
            w.value.toggled = shouldEnable;
          } else {
            w.value = { toggled: shouldEnable };
          }
          if (w.group) {
            w.group.rgthree_hasAnyActiveNode = shouldEnable;
          }
        });

        if (typeof n61.setDirtyCanvas === 'function') {
          try { n61.setDirtyCanvas(true, true); } catch (e) {}
        }
        n61Updated = true;
      }

      // 3. Garantir novamente que os nós vitais de entrada do Face Swap nunca sejam burlados
      if (normalizedTarget === 'face_swap') {
        const vitalFaceSwapIds = [3, 12, 15, 16, 18, 19, 20, 24, 26, 4, 10, 11, 5, 6, 7, 8, 9, 13, 23, 17, 25, 240, 46, 369, 371];
        vitalFaceSwapIds.forEach(id => {
          const n = (typeof graph.getNodeById === 'function') ? graph.getNodeById(id) : allNodes.find(x => x.id === id);
          if (n) n.mode = 0;
        });
      }

      // 4. Garantir que todos os nós do Carrossel permaneçam ativos no modo carrossel
      if (normalizedTarget === 'carousel') {
        const carouselIds = [386, 387, 389, 390, 391, 392, 393, 394, 395, 396, 397, 398, 399, 400, 401, 402, 403, 404, 405];
        carouselIds.forEach(id => {
          const n = (typeof graph.getNodeById === 'function') ? graph.getNodeById(id) : allNodes.find(x => x.id === id);
          if (n) n.mode = 0;
        });
      }

      // 3. Forçar redesenho completo do LiteGraph Canvas
      if (typeof graph.change === 'function') graph.change();
      if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
      const canvasObj = win.LGraphCanvas && (win.LGraphCanvas.active_canvas || (win.app && win.app.canvas));
      if (canvasObj && typeof canvasObj.draw === 'function') {
        try { canvasObj.draw(true, true); } catch (e) {}
      }

      return { success: true, targetMode: '${targetMode}', n61Updated, results };
    })();
  `;

  try {
    const res = await (targetWv || webview).executeJavaScript(switchScript);
    if (res && res.success) {
      console.log('[VELVY STUDIO] Resultado da comutação de grupo:', res);
      showToast(`⚡ Workflow configurado: Módulo [${targetMode.toUpperCase()}] ativado!`);
      return res;
    } else if (retryCount < 4) {
      console.warn(`[VELVY STUDIO] Grafo não pronto na tentativa ${retryCount + 1}. Retentando em 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      return switchWorkflowMode(targetMode, explicitWv, retryCount + 1);
    }
    return res || { success: false };
  } catch (err) {
    if (retryCount < 4) {
      await new Promise(r => setTimeout(r, 2000));
      return switchWorkflowMode(targetMode, explicitWv, retryCount + 1);
    }
    console.warn('[VELVY STUDIO] Falha ao comutar modo:', err);
    return { success: false, error: err.message };
  }
}

// Configuração completa dos formulários e eventos da Suíte 4-em-1
function setupNewModulesUI() {
  // Helper genérico para conectar dropzone de imagem com preview
  function setupImagePicker(dropId, browseBtnId, hiddenInputId, labelId, thumbId, defaultLabel) {
    const drop = document.getElementById(dropId);
    const btnBrowse = document.getElementById(browseBtnId);
    const hiddenInput = document.getElementById(hiddenInputId);
    const label = document.getElementById(labelId);
    const thumb = document.getElementById(thumbId);

    if (!drop || !btnBrowse) return;

    const selectImage = async () => {
      const file = await window.electronAPI.openFileDialog({ type: 'image' });
      if (file) {
        if (hiddenInput) hiddenInput.value = file.path;
        if (label) label.textContent = file.name;
        drop.classList.add('selected');

        try {
          const imgData = await window.electronAPI.readFileBase64(file.path);
          if (imgData && imgData.base64 && thumb) {
            thumb.src = `data:${imgData.mimeType};base64,${imgData.base64}`;
            thumb.style.display = 'block';
          }
        } catch (e) {
          if (thumb) thumb.style.display = 'none';
        }
        showToast(`🖼️ Arquivo selecionado: ${file.name}`);
      }
    };

    btnBrowse.addEventListener('click', (e) => { e.stopPropagation(); selectImage(); });
    drop.addEventListener('click', (e) => { if (e.target !== btnBrowse) selectImage(); });

    drop.addEventListener('dragover', (e) => {
      e.preventDefault();
      drop.style.borderColor = '#b34dff';
    });
    drop.addEventListener('dragleave', (e) => {
      e.preventDefault();
      drop.style.borderColor = '';
    });
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.style.borderColor = '';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (hiddenInput) hiddenInput.value = file.path;
        if (label) label.textContent = file.name;
        drop.classList.add('selected');

        try {
          const imgData = await window.electronAPI.readFileBase64(file.path);
          if (imgData && imgData.base64 && thumb) {
            thumb.src = `data:${imgData.mimeType};base64,${imgData.base64}`;
            thumb.style.display = 'block';
          }
        } catch (err) {
          if (thumb) thumb.style.display = 'none';
        }
        showToast(`🖼️ Imagem solta: ${file.name}`);
      }
    });
  }

  // 1. Face Swap Subsystem (Modelo Fixa, Lote Multi-Target 50+, Fila Automática)
  setupFaceswapSubsystem();

  // 2. 4K Upscale Pickers & Sliders
  setupImagePicker('drop-upscale-image', 'btn-browse-upscale-image', 'upscale-image-path', 'upscale-image-label', 'upscaleThumb');

  const rangeFace = document.getElementById('range-denoise-face');
  const valFace = document.getElementById('val-denoise-face');
  if (rangeFace && valFace) {
    rangeFace.addEventListener('input', () => { valFace.textContent = parseFloat(rangeFace.value).toFixed(2); });
  }

  const rangeBg = document.getElementById('range-denoise-bg');
  const valBg = document.getElementById('val-denoise-bg');
  if (rangeBg && valBg) {
    rangeBg.addEventListener('input', () => { valBg.textContent = parseFloat(rangeBg.value).toFixed(2); });
  }

  // 3. Trocador de Roupa Pickers & Default Prompt
  setupImagePicker('drop-clothes-model', 'btn-browse-clothes-model', 'clothes-model-path', 'clothes-model-label', 'clothesModelThumb');
  setupImagePicker('drop-clothes-piece', 'btn-browse-clothes-piece', 'clothes-piece-path', 'clothes-piece-label', 'clothesPieceThumb');

  const clothesPromptEl = document.getElementById('clothes-prompt-text');
  if (clothesPromptEl && !clothesPromptEl.value) {
    clothesPromptEl.value = 'IMAGE 1 = ORIGINAL CHARACTER PHOTOGRAPH.\nIMAGE 2 = CLOTHING REFERENCE.\nPerform a precise clothing replacement using image 2 as the exclusive source of clothing information. Preserve character identity, face, pose and lighting.';
  }

  // 4. Carrossel Pickers & Default Poses
  setupImagePicker('drop-carousel-main', 'btn-browse-carousel-main', 'carousel-main-path', 'carousel-main-label', 'carouselMainThumb');

  const carouselPosesEl = document.getElementById('carousel-poses-text');
  if (carouselPosesEl && !carouselPosesEl.value) {
    carouselPosesEl.value = 'sitting upright with a straight back, soft smile, eyes at the camera\nleaning back relaxed against the backrest, confident smile, eyes at the camera\nbody turned slightly to the right, head turned toward the camera, soft smile\nleaning forward with elbows on her knees, hands together, warm smile\nlegs crossed, head tilted, closed-lip smile, eyes at the camera';
  }

  // Botoes de Ação
  const btnStartFaceSwap = document.getElementById('btn-start-faceswap');
  if (btnStartFaceSwap) btnStartFaceSwap.addEventListener('click', executeFaceSwapTask);

  const btnStartUpscale = document.getElementById('btn-start-upscale');
  if (btnStartUpscale) btnStartUpscale.addEventListener('click', executeUpscaleTask);

  const btnStartClothes = document.getElementById('btn-start-clothes');
  if (btnStartClothes) btnStartClothes.addEventListener('click', executeClothesSwapTask);

  const btnStartCarousel = document.getElementById('btn-start-carousel');
  if (btnStartCarousel) btnStartCarousel.addEventListener('click', executeCarouselTask);

  const btnCancelCarousel = document.getElementById('btn-cancel-carousel');
  if (btnCancelCarousel) {
    btnCancelCarousel.addEventListener('click', async () => {
      isCarouselCancelled = true;
      showToast('🛑 Solicitando cancelamento da geração do Carrossel...');
      const targetWv = getWebviewForModule('carousel');
      await triggerCloudTaskCancel(targetWv);
    });
  }

  const badgeCarousel = document.getElementById('carousel-fixed-badge');
  if (badgeCarousel) {
    badgeCarousel.addEventListener('click', () => {
      if (fixedFaceModel && fixedFaceModel.path) {
        const p = document.getElementById('carousel-main-path');
        if (p) p.value = fixedFaceModel.path;
        const l = document.getElementById('carousel-main-label');
        if (l) l.textContent = `Modelo: ${fixedFaceModel.name}`;
        const t = document.getElementById('carouselMainThumb');
        if (t && fixedFaceModel.dataUrl) {
          t.src = fixedFaceModel.dataUrl;
          t.style.display = 'block';
        }
        showToast(`🔒 Modelo "${fixedFaceModel.name}" aplicada no Carrossel!`);
      } else {
        showToast('ℹ️ Nenhuma modelo fixada ainda. Fixe uma modelo no Face Swap!');
      }
    });
  }

  // Botões de Abrir Pasta
  ['faceswap', 'upscale', 'clothes', 'carousel'].forEach(mod => {
    const btnOpen = document.getElementById(`btn-open-folder-${mod}`);
    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        window.electronAPI.openDirectoryInExplorer(appSettings.outputDir);
      });
    }
  });
}

// Helper compartilhado para capturar URLs e referências de saída antes de uma execução
async function captureNodeBaselines(wv, saveNodeIds) {
  if (!wv) return [];
  const script = `
    (() => {
      ${getComfyGraphFinderScript()}
      const graph = getGraphInstance();
      const ctx = findComfyContext();
      const existingUrls = [];

      function normalizeImageId(str) {
        if (!str) return '';
        let s = str.toString().toLowerCase();
        const m = s.match(/filename=([^&]+)/);
        if (m) s = decodeURIComponent(m[1]);
        s = s.split('?')[0].split('#')[0];
        const parts = s.split('/').pop().split(String.fromCharCode(92)).pop();
        return (parts || '').trim();
      }

      function add(val) {
        if (!val) return;
        const norm = normalizeImageId(val);
        if (norm && norm.length > 2 && !existingUrls.includes(norm)) existingUrls.push(norm);
        const strVal = val.toString().trim();
        if (strVal && !existingUrls.includes(strVal)) existingUrls.push(strVal);
      }

      if (graph) {
        const ids = ${JSON.stringify(saveNodeIds)};
        ids.forEach(id => {
          const n = (typeof graph.getNodeById === 'function') ? graph.getNodeById(id) : null;
          if (n) {
            if (Array.isArray(n.imgs)) {
              n.imgs.forEach(img => { if (img && img.src) add(img.src); });
            }
            if (n.image && n.image.src) add(n.image.src);
            if (Array.isArray(n.images)) {
              n.images.forEach(item => {
                if (typeof item === 'string') add(item);
                else if (item && item.filename) add(item.filename);
              });
            }
            if (Array.isArray(n.widgets)) {
              n.widgets.forEach(w => {
                if (w && w.element && w.element.src) add(w.element.src);
                if (w && typeof w.value === 'string') add(w.value);
              });
            }
          }
          if (ctx && ctx.app) {
            if (ctx.app.nodeOutputs && ctx.app.nodeOutputs[id]) {
              const outObj = ctx.app.nodeOutputs[id];
              if (outObj && Array.isArray(outObj.images)) {
                outObj.images.forEach(item => {
                  if (typeof item === 'string') add(item);
                  else if (item && item.filename) add(item.filename);
                });
              }
            }
            if (ctx.app.lastNodeOutputs && ctx.app.lastNodeOutputs[id]) {
              const outObj = ctx.app.lastNodeOutputs[id];
              if (outObj && Array.isArray(outObj.images)) {
                outObj.images.forEach(item => {
                  if (typeof item === 'string') add(item);
                  else if (item && item.filename) add(item.filename);
                });
              }
            }
          }
        });
      }
      return existingUrls;
    })();
  `;
  try {
    return await wv.executeJavaScript(script) || [];
  } catch (e) {
    return [];
  }
}

// Monitor e extrator genérico de saída de imagem para nós ComfyUI
async function waitForImageOutput(moduleName, saveNodeIds, sleepNodeId, statusEl, progressEl, progressBarEl, previewImgEl, placeholderEl, downloadBtnEl, explicitWv, explicitBaselines) {
  const wv = explicitWv || getWebviewForModule(moduleName.toLowerCase().replace(/ /g, '_'));
  const startTime = Date.now();
  const maxTimeoutMs = 300000; // 5 minutos
  const checkIntervalMs = 2500;
  // Trava anti-duplicação: impede falso positivo nos primeiros 25 segundos
  const minWaitSeconds = 25;

  let baselineUrls = explicitBaselines;
  if (!baselineUrls || !Array.isArray(baselineUrls)) {
    baselineUrls = await captureNodeBaselines(wv || webview, saveNodeIds);
  }

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

      // Timeout safety
      if (Date.now() - startTime > maxTimeoutMs) {
        clearInterval(interval);
        return reject(new Error('Tempo limite excedido aguardando imagem gerada na nuvem.'));
      }

      // Impede detecção prematura durante inicialização/upload
      if (elapsedSec < minWaitSeconds) {
        if (statusEl) statusEl.textContent = `[${moduleName}] Renderizando na nuvem (${elapsedSec}s / ${minWaitSeconds}s trava anti-duplicação)... Monitorando nó ${saveNodeIds.join(', ')}...`;
        return;
      }

      if (statusEl) statusEl.textContent = `[${moduleName}] Processando IA (${elapsedSec}s decorridos)... Monitorando saída nó ${saveNodeIds.join(', ')}...`;

      const pollScript = `
        (async () => {
          try {
            ${getComfyGraphFinderScript()}
            const graph = getGraphInstance();
            if (!graph) return { found: false };

            const ids = ${JSON.stringify(saveNodeIds)};
            const baselines = ${JSON.stringify(baselineUrls || [])};

            const ctx = findComfyContext();

            function normalizeImageId(str) {
              if (!str) return '';
              let s = str.toString().toLowerCase();
              const m = s.match(/filename=([^&]+)/);
              if (m) s = decodeURIComponent(m[1]);
              s = s.split('?')[0].split('#')[0];
              const parts = s.split('/').pop().split(String.fromCharCode(92)).pop();
              return (parts || '').trim();
            }

            function isAlreadyInBaselines(target) {
              if (!target || !baselines || baselines.length === 0) return false;
              const normTarget = normalizeImageId(target);
              const rawTarget = target.toString().toLowerCase().trim();

              return baselines.some(b => {
                if (!b) return false;
                const normB = normalizeImageId(b);
                const rawB = b.toString().toLowerCase().trim();
                if (normTarget && normB && normTarget === normB) return true;
                if (rawTarget === rawB) return true;
                if (normTarget && normTarget.length > 3 && rawB.includes(normTarget)) return true;
                if (normB && normB.length > 3 && rawTarget.includes(normB)) return true;
                return false;
              });
            }

            const extractImage = async (src, imgEl) => {
              try {
                if (!src && imgEl) src = imgEl.src;
                if (!src) return null;

                if (src.startsWith('data:image/')) return src;

                if (imgEl && (imgEl.naturalWidth || imgEl.width)) {
                  try {
                    const canvas = document.createElement('canvas');
                    canvas.width = imgEl.naturalWidth || imgEl.width || 1024;
                    canvas.height = imgEl.naturalHeight || imgEl.height || 1024;
                    const c2d = canvas.getContext('2d');
                    c2d.drawImage(imgEl, 0, 0);
                    const dataUrl = canvas.toDataURL('image/png');
                    if (dataUrl && dataUrl.length > 100) return dataUrl;
                  } catch (e) {}
                }

                try {
                  const isBlob = (typeof src === 'string' && src.startsWith('blob:'));
                  const res = await fetch(src, isBlob ? {} : { credentials: 'include' });
                  if (res && res.ok) {
                    const blob = await res.blob();
                    const reader = new FileReader();
                    const b64 = await new Promise((resB64, rejB64) => {
                      reader.onloadend = () => resB64(reader.result);
                      reader.onerror = () => rejB64(new Error('FileReader failed'));
                      reader.readAsDataURL(blob);
                    });
                    if (b64 && b64.length > 100) return b64;
                  }
                } catch (e) {}

                return src;
              } catch (err) {
                return null;
              }
            };

            for (const id of ids) {
              const node = (typeof graph.getNodeById === 'function') ? graph.getNodeById(id) : null;
              if (!node) continue;

              // 1. Verificar node.imgs (Array de Image elements)
              if (Array.isArray(node.imgs) && node.imgs.length > 0) {
                for (const img of node.imgs) {
                  if (img && img.src) {
                    if (isAlreadyInBaselines(img.src)) continue;
                    const dataUrl = await extractImage(img.src, img);
                    if (dataUrl) return { found: true, dataUrl: dataUrl, nodeId: id, reason: 'new_img_src' };
                  }
                }
              }

              // 2. Verificar node.image (Image element individual)
              if (node.image && node.image.src) {
                if (!isAlreadyInBaselines(node.image.src)) {
                  const dataUrl = await extractImage(node.image.src, node.image);
                  if (dataUrl) return { found: true, dataUrl: dataUrl, nodeId: id, reason: 'new_image_src' };
                }
              }

              // 3. Verificar node.images (metadados ComfyUI [{ filename, subfolder, type }])
              if (Array.isArray(node.images) && node.images.length > 0) {
                for (const item of node.images) {
                  const fn = typeof item === 'string' ? item : (item && item.filename);
                  if (fn && !isAlreadyInBaselines(fn)) {
                    const sub = (item && item.subfolder) ? item.subfolder : '';
                    const type = (item && item.type) ? item.type : 'temp';
                    const comfyWin = ctx ? ctx.win : window;
                    let comfyOrigin = window.location.origin;
                    try {
                      if (comfyWin && comfyWin.location && typeof comfyWin.location.origin === 'string') {
                        comfyOrigin = comfyWin.location.origin;
                      }
                    } catch (e) {}

                    const apiObj = comfyWin && (comfyWin.api || (comfyWin.app && comfyWin.app.api));
                    let viewUrl = '';
                    if (apiObj && typeof apiObj.apiURL === 'function') {
                      try {
                        viewUrl = apiObj.apiURL('/view?filename=' + encodeURIComponent(fn) + '&type=' + encodeURIComponent(type) + '&subfolder=' + encodeURIComponent(sub));
                      } catch (e) {}
                    }
                    if (!viewUrl) {
                      viewUrl = comfyOrigin + '/view?filename=' + encodeURIComponent(fn) + '&type=' + encodeURIComponent(type) + '&subfolder=' + encodeURIComponent(sub);
                    }
                    const extracted = await extractImage(viewUrl);
                    if (extracted) return { found: true, dataUrl: extracted, nodeId: id, reason: 'new_filename' };
                  }
                }
              }

              // 4. Verificar ctx.app.nodeOutputs (onde ComfyUI armazena a saída diretamente)
              if (ctx && ctx.app) {
                const outputs = (ctx.app.nodeOutputs && (ctx.app.nodeOutputs[id] || ctx.app.nodeOutputs[String(id)])) ||
                                (ctx.app.lastNodeOutputs && (ctx.app.lastNodeOutputs[id] || ctx.app.lastNodeOutputs[String(id)]));
                if (outputs && Array.isArray(outputs.images)) {
                  for (const item of outputs.images) {
                    const fn = typeof item === 'string' ? item : (item && item.filename);
                    if (fn && !isAlreadyInBaselines(fn)) {
                      const sub = (item && item.subfolder) ? item.subfolder : '';
                      const type = (item && item.type) ? item.type : 'temp';
                      const comfyWin = ctx.win || window;
                      const apiObj = comfyWin.api || (comfyWin.app && comfyWin.app.api);
                      let viewUrl = '';
                      if (apiObj && typeof apiObj.apiURL === 'function') {
                        try {
                          viewUrl = apiObj.apiURL('/view?filename=' + encodeURIComponent(fn) + '&type=' + encodeURIComponent(type) + '&subfolder=' + encodeURIComponent(sub));
                        } catch (e) {}
                      }
                      if (!viewUrl) {
                        viewUrl = (comfyWin.location ? comfyWin.location.origin : window.location.origin) + '/view?filename=' + encodeURIComponent(fn) + '&type=' + encodeURIComponent(type) + '&subfolder=' + encodeURIComponent(sub);
                      }
                      const extracted = await extractImage(viewUrl);
                      if (extracted) return { found: true, dataUrl: extracted, nodeId: id, reason: 'new_nodeOutputs' };
                    }
                  }
                }
              }

              // 5. Verificar widgets com elemento IMG
              if (Array.isArray(node.widgets)) {
                for (const w of node.widgets) {
                  if (w && w.element && w.element.tagName === 'IMG' && w.element.src) {
                    if (!isAlreadyInBaselines(w.element.src)) {
                      const dataUrl = await extractImage(w.element.src, w.element);
                      if (dataUrl) return { found: true, dataUrl: dataUrl, nodeId: id, reason: 'new_widget_src' };
                    }
                  }
                }
              }
            }

            return { found: false };
          } catch (topErr) {
            return { found: false, error: topErr ? topErr.message : String(topErr) };
          }
        })();
      `;

      try {
        const checkRes = await (wv || webview).executeJavaScript(pollScript);
        if (checkRes && checkRes.error) {
          console.warn(`[VELVY STUDIO] Aviso dentro do pollScript [${moduleName}]:`, checkRes.error);
        }
        if (checkRes && checkRes.found && checkRes.dataUrl) {
          clearInterval(interval);
          resolve(checkRes.dataUrl);
        }
      } catch (pollErr) {
        console.warn(`[VELVY STUDIO] Erro no poll de imagem [${moduleName}]:`, pollErr.message);
      }
    }, checkIntervalMs);
  });
}

// ==========================================
// 1. SUBSISTEMA COMPLETO: FACE SWAP
// - Gestão de Rosto Fixo / Catálogo de Modelas
// - Upload em Lote de 50+ Fotos de Destino
// - Fila Automática Sequencial com Cancelamento de Sleep (Zero Créditos)
// ==========================================

let faceswapQueue = [];
let isFaceswapQueueRunning = false;
let isFaceswapPaused = false;
let fixedFaceModel = null;
let selectedFaceswapTargets = [];
let cachedUploadedFacePath = null;
let cachedUploadedFaceServerName = null;
let cachedUploadedCarouselMainPath = null;
let cachedUploadedCarouselMainServerName = null;
let isCarouselCancelled = false;

function getSavedModels() {
  try {
    const raw = localStorage.getItem('velvy_saved_models');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function setSavedModels(models) {
  try {
    localStorage.setItem('velvy_saved_models', JSON.stringify(models));
  } catch (e) {
    console.warn('[VELVY STUDIO] Erro ao salvar modelos no localStorage:', e);
  }
}

function updateFixedBadge(model) {
  const badges = [
    { badge: document.getElementById('faceswap-fixed-badge'), text: document.getElementById('faceswap-fixed-badge-text'), icon: document.getElementById('faceswap-badge-icon') },
    { badge: document.getElementById('video-fixed-badge'), text: document.getElementById('video-fixed-badge-text'), icon: document.getElementById('video-badge-icon') },
    { badge: document.getElementById('clothes-fixed-badge'), text: document.getElementById('clothes-fixed-badge-text'), icon: document.getElementById('clothes-badge-icon') },
    { badge: document.getElementById('carousel-fixed-badge'), text: document.getElementById('carousel-fixed-badge-text'), icon: document.getElementById('carousel-badge-icon') }
  ];

  badges.forEach(({ badge, text, icon }) => {
    if (!badge || !text) return;
    if (model) {
      badge.classList.add('active-locked');
      text.textContent = `🔒 Modelo Fixada: ${model.name}`;
      if (icon) icon.textContent = '🔒';
    } else {
      badge.classList.remove('active-locked');
      text.textContent = 'Nenhuma modelo fixada (Use foto avulsa ou fixe uma modelo)';
      if (icon) icon.textContent = '🔓';
    }
  });

  // Atualiza previews visuais nas abas secundárias se o usuário não escolheu arquivo avulso
  if (model && model.path) {
    const videoImgPath = document.getElementById('image-path');
    const videoImgThumb = document.getElementById('imageThumb');
    const videoImgLabel = document.getElementById('image-label');
    if (videoImgPath && !videoImgPath.value) {
      videoImgPath.value = model.path;
      if (videoImgLabel) videoImgLabel.textContent = `Modelo: ${model.name}`;
      if (videoImgThumb && model.dataUrl) {
        videoImgThumb.src = model.dataUrl;
        videoImgThumb.style.display = 'block';
      }
    }

    const clothesModelPath = document.getElementById('clothes-model-path');
    const clothesModelThumb = document.getElementById('clothesModelThumb');
    const clothesModelLabel = document.getElementById('clothes-model-label');
    if (clothesModelPath && !clothesModelPath.value) {
      clothesModelPath.value = model.path;
      if (clothesModelLabel) clothesModelLabel.textContent = `Modelo: ${model.name}`;
      if (clothesModelThumb && model.dataUrl) {
        clothesModelThumb.src = model.dataUrl;
        clothesModelThumb.style.display = 'block';
      }
    }

    const carouselMainPath = document.getElementById('carousel-main-path');
    const carouselMainThumb = document.getElementById('carouselMainThumb');
    const carouselMainLabel = document.getElementById('carousel-main-label');
    if (carouselMainPath && !carouselMainPath.value) {
      carouselMainPath.value = model.path;
      if (carouselMainLabel) carouselMainLabel.textContent = `Modelo: ${model.name}`;
      if (carouselMainThumb && model.dataUrl) {
        carouselMainThumb.src = model.dataUrl;
        carouselMainThumb.style.display = 'block';
      }
    }
  }
}

function renderModelPresetsDropdown() {
  const select = document.getElementById('faceswap-model-preset');
  if (!select) return;

  const models = getSavedModels();
  select.innerHTML = '<option value="">-- Selecionar Modelo Salva --</option>';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    if (fixedFaceModel && fixedFaceModel.id === m.id) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function selectModelPreset(modelId) {
  if (!modelId) {
    fixedFaceModel = null;
    updateFixedBadge(null);
    return;
  }
  const models = getSavedModels();
  const m = models.find(x => x.id === modelId);
  if (m) {
    const facePathInput = document.getElementById('faceswap-face-path');
    const faceLabel = document.getElementById('faceswap-face-label');
    const faceThumb = document.getElementById('faceswapFaceThumb');
    const dropFace = document.getElementById('drop-faceswap-face');

    if (facePathInput) facePathInput.value = m.path;
    if (faceLabel) faceLabel.textContent = `Modelo: ${m.name}`;
    if (faceThumb && m.dataUrl) {
      faceThumb.src = m.dataUrl;
      faceThumb.style.display = 'block';
    }
    if (dropFace) dropFace.classList.add('selected');

    fixedFaceModel = m;
    updateFixedBadge(m);
    cachedUploadedFacePath = null;
    cachedUploadedFaceServerName = null;
    showToast(`👤 Modelo carregada e fixada: ${m.name}`);
  }
}

async function saveCurrentModelAsPreset() {
  const facePath = document.getElementById('faceswap-face-path')?.value;
  if (!facePath) {
    showToast('⚠️ Selecione a foto do rosto da modelo antes de salvar!');
    return;
  }

  const defaultName = `Modelo_${getSavedModels().length + 1}`;
  const name = prompt('Digite o nome desta Modelo para salvar no catálogo:', defaultName);
  if (!name || !name.trim()) return;

  try {
    const imgData = await window.electronAPI.readFileBase64(facePath);
    const models = getSavedModels();
    const newModel = {
      id: `model_${Date.now()}`,
      name: name.trim(),
      path: facePath,
      dataUrl: `data:${imgData.mimeType};base64,${imgData.base64}`,
      date: new Date().toLocaleDateString('pt-BR')
    };
    models.push(newModel);
    setSavedModels(models);

    fixedFaceModel = newModel;
    renderModelPresetsDropdown();
    selectModelPreset(newModel.id);
    showToast(`💾 Modelo "${newModel.name}" salva com sucesso!`);
  } catch (err) {
    showToast(`❌ Erro ao salvar modelo: ${err.message}`);
  }
}

function toggleFixedFace() {
  const facePath = document.getElementById('faceswap-face-path')?.value;
  if (fixedFaceModel) {
    fixedFaceModel = null;
    updateFixedBadge(null);
    showToast('🔓 Rosto desafixado');
  } else {
    if (!facePath) {
      showToast('⚠️ Selecione uma foto ou modelo primeiro para fixar!');
      return;
    }
    const faceLabel = document.getElementById('faceswap-face-label')?.textContent || 'Modelo Fixa';
    fixedFaceModel = {
      id: `custom_${Date.now()}`,
      name: faceLabel.replace(/^Modelo:\s*/, '').trim(),
      path: facePath
    };
    updateFixedBadge(fixedFaceModel);
    showToast(`🔒 Rosto fixado com sucesso: ${fixedFaceModel.name}`);
  }
}

function deleteSelectedModel() {
  const select = document.getElementById('faceswap-model-preset');
  if (!select || !select.value) {
    showToast('⚠️ Selecione uma modelo salva no menu para excluir.');
    return;
  }
  const modelId = select.value;
  let models = getSavedModels();
  const m = models.find(x => x.id === modelId);
  if (m && confirm(`Deseja realmente excluir a modelo "${m.name}"?`)) {
    models = models.filter(x => x.id !== modelId);
    setSavedModels(models);
    if (fixedFaceModel && fixedFaceModel.id === modelId) {
      fixedFaceModel = null;
      updateFixedBadge(null);
    }
    renderModelPresetsDropdown();
    showToast('🗑️ Modelo excluída com sucesso');
  }
}

async function handleFaceswapTargetsPicked(files) {
  if (!files) return;
  const fileList = Array.isArray(files) ? files : [files];
  if (fileList.length === 0) return;

  selectedFaceswapTargets = fileList.map(f => ({
    path: f.path,
    name: f.name,
    size: f.size
  }));

  const counterBadge = document.getElementById('faceswap-target-counter');
  const countText = document.getElementById('faceswap-target-count-text');
  const strip = document.getElementById('faceswap-targets-preview-strip');
  const stripCount = document.getElementById('faceswap-strip-count');
  const stripThumbs = document.getElementById('faceswap-strip-thumbs');
  const thumb = document.getElementById('faceswapTargetThumb');
  const label = document.getElementById('faceswap-target-label');
  const drop = document.getElementById('drop-faceswap-target');
  const clearBtn = document.getElementById('btn-clear-faceswap-targets');
  const hiddenInput = document.getElementById('faceswap-target-path');

  if (hiddenInput) hiddenInput.value = fileList[0].path;
  if (drop) drop.classList.add('selected');
  if (clearBtn) clearBtn.style.display = 'inline-block';

  if (fileList.length === 1) {
    if (counterBadge) counterBadge.style.display = 'none';
    if (strip) strip.style.display = 'none';
    if (label) label.textContent = fileList[0].name;
    try {
      const data = await window.electronAPI.readFileBase64(fileList[0].path);
      if (thumb && data) {
        thumb.src = `data:${data.mimeType};base64,${data.base64}`;
        thumb.style.display = 'block';
      }
    } catch(e) {}
  } else {
    if (counterBadge) {
      counterBadge.style.display = 'inline-block';
      if (countText) countText.textContent = `✨ ${fileList.length} imagens selecionadas em lote`;
    }
    if (label) label.textContent = `${fileList.length} imagens no lote (Prontas para a fila)`;
    
    try {
      const data = await window.electronAPI.readFileBase64(fileList[0].path);
      if (thumb && data) {
        thumb.src = `data:${data.mimeType};base64,${data.base64}`;
        thumb.style.display = 'block';
      }
    } catch(e) {}

    if (strip && stripThumbs) {
      strip.style.display = 'block';
      if (stripCount) stripCount.textContent = `${fileList.length} fotos`;
      stripThumbs.innerHTML = '';
      const previewLimit = Math.min(fileList.length, 25);
      for (let i = 0; i < previewLimit; i++) {
        const f = fileList[i];
        const img = document.createElement('img');
        img.className = 'target-mini-thumb';
        img.title = f.name;
        window.electronAPI.readFileBase64(f.path).then(d => {
          if (d && d.base64) img.src = `data:${d.mimeType};base64,${d.base64}`;
        }).catch(() => {});
        stripThumbs.appendChild(img);
      }
      if (fileList.length > previewLimit) {
        const moreSpan = document.createElement('span');
        moreSpan.style.cssText = 'display:grid;place-items:center;padding:0 10px;font-size:11px;color:#a892c9;';
        moreSpan.textContent = `+${fileList.length - previewLimit} mais`;
        stripThumbs.appendChild(moreSpan);
      }
    }
  }

  showToast(`📸 ${fileList.length} imagem(ns) de destino selecionada(s)!`);
}

function clearFaceswapTargetsSelection() {
  selectedFaceswapTargets = [];
  const hiddenInput = document.getElementById('faceswap-target-path');
  const label = document.getElementById('faceswap-target-label');
  const thumb = document.getElementById('faceswapTargetThumb');
  const drop = document.getElementById('drop-faceswap-target');
  const counterBadge = document.getElementById('faceswap-target-counter');
  const strip = document.getElementById('faceswap-targets-preview-strip');
  const clearBtn = document.getElementById('btn-clear-faceswap-targets');

  if (hiddenInput) hiddenInput.value = '';
  if (label) label.textContent = 'Cena, corpo ou roupa alvo (Node #17)';
  if (thumb) { thumb.src = ''; thumb.style.display = 'none'; }
  if (drop) drop.classList.remove('selected');
  if (counterBadge) counterBadge.style.display = 'none';
  if (strip) strip.style.display = 'none';
  if (clearBtn) clearBtn.style.display = 'none';
  showToast('Seleção de imagens limpa');
}

function setupFaceswapSubsystem() {
  // Preset Controls
  renderModelPresetsDropdown();
  const selectPreset = document.getElementById('faceswap-model-preset');
  if (selectPreset) selectPreset.addEventListener('change', (e) => selectModelPreset(e.target.value));

  const btnSaveModel = document.getElementById('btn-save-fixed-model');
  if (btnSaveModel) btnSaveModel.addEventListener('click', saveCurrentModelAsPreset);

  const btnToggleFix = document.getElementById('btn-toggle-fixed-face');
  if (btnToggleFix) btnToggleFix.addEventListener('click', toggleFixedFace);

  const btnDeleteModel = document.getElementById('btn-delete-fixed-model');
  if (btnDeleteModel) btnDeleteModel.addEventListener('click', deleteSelectedModel);

  // Face Picker (Node 23)
  const dropFace = document.getElementById('drop-faceswap-face');
  const btnBrowseFace = document.getElementById('btn-browse-faceswap-face');
  const inputFacePath = document.getElementById('faceswap-face-path');
  const labelFace = document.getElementById('faceswap-face-label');
  const thumbFace = document.getElementById('faceswapFaceThumb');

  const pickFace = async () => {
    const file = await window.electronAPI.openFileDialog({ type: 'image' });
    if (file) {
      if (inputFacePath) inputFacePath.value = file.path;
      if (labelFace) labelFace.textContent = file.name;
      if (dropFace) dropFace.classList.add('selected');
      try {
        const d = await window.electronAPI.readFileBase64(file.path);
        if (thumbFace && d) {
          thumbFace.src = `data:${d.mimeType};base64,${d.base64}`;
          thumbFace.style.display = 'block';
        }
      } catch(e) {}
      cachedUploadedFacePath = null;
      cachedUploadedFaceServerName = null;
      showToast(`📸 Rosto selecionado: ${file.name}`);
    }
  };

  if (btnBrowseFace) btnBrowseFace.addEventListener('click', (e) => { e.stopPropagation(); pickFace(); });
  if (dropFace) {
    dropFace.addEventListener('click', (e) => { if (e.target !== btnBrowseFace) pickFace(); });
    dropFace.addEventListener('dragover', (e) => { e.preventDefault(); dropFace.style.borderColor = '#b34dff'; });
    dropFace.addEventListener('dragleave', (e) => { e.preventDefault(); dropFace.style.borderColor = ''; });
    dropFace.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropFace.style.borderColor = '';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (inputFacePath) inputFacePath.value = file.path;
        if (labelFace) labelFace.textContent = file.name;
        if (dropFace) dropFace.classList.add('selected');
        try {
          const d = await window.electronAPI.readFileBase64(file.path);
          if (thumbFace && d) {
            thumbFace.src = `data:${d.mimeType};base64,${d.base64}`;
            thumbFace.style.display = 'block';
          }
        } catch(err) {}
        cachedUploadedFacePath = null;
        cachedUploadedFaceServerName = null;
        showToast(`📸 Rosto solto: ${file.name}`);
      }
    });
  }

  // Target Multi-Picker (Node 17)
  const dropTarget = document.getElementById('drop-faceswap-target');
  const btnBrowseTarget = document.getElementById('btn-browse-faceswap-target');
  const btnClearTargets = document.getElementById('btn-clear-faceswap-targets');

  const pickTargets = async () => {
    const files = await window.electronAPI.openFileDialog({ type: 'image', multiple: true });
    if (files) {
      await handleFaceswapTargetsPicked(files);
    }
  };

  if (btnBrowseTarget) btnBrowseTarget.addEventListener('click', (e) => { e.stopPropagation(); pickTargets(); });
  if (btnClearTargets) btnClearTargets.addEventListener('click', (e) => { e.stopPropagation(); clearFaceswapTargetsSelection(); });
  if (dropTarget) {
    dropTarget.addEventListener('click', (e) => {
      if (e.target !== btnBrowseTarget && e.target !== btnClearTargets) pickTargets();
    });
    dropTarget.addEventListener('dragover', (e) => { e.preventDefault(); dropTarget.style.borderColor = '#b34dff'; });
    dropTarget.addEventListener('dragleave', (e) => { e.preventDefault(); dropTarget.style.borderColor = ''; });
    dropTarget.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropTarget.style.borderColor = '';
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const fileList = Array.from(e.dataTransfer.files);
        await handleFaceswapTargetsPicked(fileList);
      }
    });
  }

  // Queue Control Buttons
  const btnAddQueue = document.getElementById('btn-add-faceswap-queue');
  if (btnAddQueue) btnAddQueue.addEventListener('click', addFaceswapToQueue);

  const btnStartQueue = document.getElementById('btn-start-faceswap-queue');
  if (btnStartQueue) btnStartQueue.addEventListener('click', startFaceswapQueue);

  const btnPauseQueue = document.getElementById('btn-pause-faceswap-queue');
  if (btnPauseQueue) btnPauseQueue.addEventListener('click', pauseFaceswapQueue);

  const btnClearQueue = document.getElementById('btn-clear-faceswap-queue');
  if (btnClearQueue) btnClearQueue.addEventListener('click', clearFinishedFaceswapQueue);

  renderFaceswapQueue();
}

function addFaceswapToQueue() {
  const facePath = fixedFaceModel ? fixedFaceModel.path : document.getElementById('faceswap-face-path')?.value;
  const faceName = fixedFaceModel ? fixedFaceModel.name : (document.getElementById('faceswap-face-label')?.textContent || 'Modelo');

  if (!facePath) {
    showToast('⚠️ Por favor selecione ou fixe o rosto da modelo primeiro!');
    return;
  }

  let targetsToAdd = [];
  if (selectedFaceswapTargets && selectedFaceswapTargets.length > 0) {
    targetsToAdd = [...selectedFaceswapTargets];
  } else {
    const singlePath = document.getElementById('faceswap-target-path')?.value;
    const singleName = document.getElementById('faceswap-target-label')?.textContent || 'Alvo';
    if (singlePath) {
      targetsToAdd.push({ path: singlePath, name: singleName });
    }
  }

  if (targetsToAdd.length === 0) {
    showToast('⚠️ Selecione pelo menos uma imagem de destino (ou arraste várias fotos)!');
    return;
  }

  const batchName = document.getElementById('faceswap-task-name')?.value || 'FaceSwap';

  targetsToAdd.forEach((target, idx) => {
    faceswapQueue.push({
      id: `fs_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
      taskName: `${batchName}_${target.name.replace(/\.[^/.]+$/, '')}`,
      facePath: facePath,
      faceName: faceName,
      targetPath: target.path,
      targetName: target.name,
      status: 'waiting',
      resultPath: null,
      dataUrl: null,
      error: null
    });
  });

  renderFaceswapQueue();
  showToast(`🎭 ${targetsToAdd.length} tarefa(s) adicionada(s) à fila de Face Swap!`);
}

function renderFaceswapQueue() {
  const container = document.getElementById('faceswap-queue-items-container');
  const summary = document.getElementById('faceswap-queue-summary');
  if (!container) return;

  const waitingCount = faceswapQueue.filter(t => t.status === 'waiting').length;
  const doneCount = faceswapQueue.filter(t => t.status === 'done').length;
  const total = faceswapQueue.length;

  if (summary) {
    summary.textContent = `${total} tarefas (${waitingCount} aguardando, ${doneCount} prontas)`;
  }

  if (total === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Nenhuma tarefa de Face Swap na fileira.</p>
        <span>Fixe ou selecione o rosto da modelo, escolha até 50+ fotos de destino e clique em "Adicionar à Fila" ou "Iniciar Fila".</span>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  faceswapQueue.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = `task-card ${item.status === 'processing' ? 'active-running' : ''}`;
    card.id = `faceswap-card-${item.id}`;

    let statusTagHtml = '';
    if (item.status === 'waiting') {
      statusTagHtml = '<span class="task-status-tag" style="background:#201138;color:#a892c9;">AGUARDANDO</span>';
    } else if (item.status === 'processing') {
      statusTagHtml = '<span class="task-status-tag" style="background:#4c1d95;color:#e9d5ff;">PROCESSANDO...</span>';
    } else if (item.status === 'done') {
      statusTagHtml = '<span class="task-status-tag status-done">CONCLUÍDO</span>';
    } else if (item.status === 'error') {
      statusTagHtml = `<span class="task-status-tag" style="background:#581c1c;color:#fecaca;" title="${item.error || 'Erro'}">ERRO</span>`;
    }

    let actionsHtml = '';
    if (item.status === 'done' && item.resultPath) {
      actionsHtml += `
        <button type="button" class="btn-task-action" onclick="window.previewFaceswapResult('${item.id}')">👁️ Ver</button>
        <button type="button" class="btn-task-action" onclick="window.electronAPI.openDirectoryInExplorer(appSettings.outputDir)">📁</button>
      `;
    }
    if (item.status !== 'processing') {
      actionsHtml += `<button type="button" class="btn-task-action danger" onclick="window.removeFaceswapQueueItem('${item.id}')">✕</button>`;
    }

    card.innerHTML = `
      <div class="task-card-left">
        <div class="task-index">#${index + 1}</div>
        <div class="task-info">
          <h4>${item.taskName}</h4>
          <p>Destino: <b>${item.targetName}</b> • Modelo: <b>${item.faceName}</b></p>
        </div>
      </div>
      <div class="task-card-right">
        ${statusTagHtml}
        <div class="task-actions">${actionsHtml}</div>
      </div>
    `;
    container.appendChild(card);
  });
}

window.previewFaceswapResult = async function(id) {
  const item = faceswapQueue.find(t => t.id === id);
  if (item && (item.dataUrl || item.resultPath)) {
    const previewImg = document.getElementById('faceswap-preview-img');
    const placeholder = document.getElementById('faceswap-placeholder');
    const btnDownload = document.getElementById('btn-download-faceswap');

    let src = item.dataUrl;
    if (!src || !src.startsWith('data:')) {
      try {
        const fileData = await window.electronAPI.readFileBase64(item.resultPath);
        src = `data:${fileData.mimeType || 'image/png'};base64,${fileData.base64}`;
        item.dataUrl = src;
      } catch (e) {
        src = 'file:///' + item.resultPath.replace(/\\/g, '/');
      }
    }

    if (previewImg && placeholder) {
      previewImg.src = src;
      previewImg.style.display = 'block';
      placeholder.style.display = 'none';
    }
    if (btnDownload) {
      btnDownload.disabled = false;
      btnDownload.onclick = () => window.electronAPI.downloadVideo({ url: src, filename: `SWAP_${item.taskName}.png`, outputDir: appSettings.outputDir });
    }
    showToast(`👁️ Exibindo resultado: ${item.taskName}`);
  }
};

window.removeFaceswapQueueItem = function(id) {
  faceswapQueue = faceswapQueue.filter(t => t.id !== id);
  renderFaceswapQueue();
  showToast('Tarefa removida da fila');
};

function updateFaceswapQueueControls() {
  const btnStart = document.getElementById('btn-start-faceswap-queue');
  const btnPause = document.getElementById('btn-pause-faceswap-queue');
  const btnText = document.getElementById('faceswap-btn-text');

  if (isFaceswapQueueRunning && !isFaceswapPaused) {
    if (btnText) btnText.textContent = '✦ Processando Fila...';
    if (btnStart) btnStart.disabled = true;
    if (btnPause) { btnPause.disabled = false; btnPause.textContent = '⏸ Pausar'; }
  } else if (isFaceswapPaused) {
    if (btnText) btnText.textContent = '▶ Retomar Fila';
    if (btnStart) btnStart.disabled = false;
    if (btnPause) { btnPause.disabled = true; btnPause.textContent = 'Pausado'; }
  } else {
    if (btnText) btnText.textContent = '✦　Iniciar Fila de Face Swap　→';
    if (btnStart) btnStart.disabled = false;
    if (btnPause) { btnPause.disabled = true; btnPause.textContent = '⏸ Pausar'; }
  }
}

function startFaceswapQueue() {
  const waitingTasks = faceswapQueue.filter(t => t.status === 'waiting');
  if (waitingTasks.length === 0) {
    addFaceswapToQueue();
  }

  if (faceswapQueue.filter(t => t.status === 'waiting').length === 0) {
    showToast('⚠️ Nenhuma tarefa pendente na fila.');
    return;
  }

  isFaceswapQueueRunning = true;
  isFaceswapPaused = false;
  updateFaceswapQueueControls();
  processNextInFaceSwapQueue();
}

function pauseFaceswapQueue() {
  isFaceswapPaused = true;
  updateFaceswapQueueControls();
  showToast('⏸ Fila de Face Swap será pausada após a tarefa atual');
}

// Helper compartilhado para injeção de upload de arquivos com autenticação robusta (RunningHub + ComfyUI)
function getCloudUploadScriptHelper() {
  return `
    ${getComfyGraphFinderScript()}

    function getCredentials() {
      let apiKey = '${(appSettings.apiKey || '').replace(/'/g, "\\'")}';
      let token = '';

      function scanStorage(storage) {
        if (!storage) return;
        try {
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            const v = storage.getItem(k);
            if (!v) continue;
            if (!apiKey && (k.toLowerCase().includes('apikey') || k.toLowerCase().includes('api_key'))) {
              apiKey = v.replace(/["']/g, '').trim();
            }
            if (!token && (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth') || k.toLowerCase().includes('user') || (typeof v === 'string' && v.startsWith('eyJ')))) {
              try {
                const obj = JSON.parse(v);
                if (!apiKey && (obj.apiKey || obj.apikey || obj.api_key)) apiKey = obj.apiKey || obj.apikey || obj.api_key;
                if (obj.token || obj.accessToken || obj.access_token) token = obj.token || obj.accessToken || obj.access_token;
              } catch (e) {
                if (!token && typeof v === 'string') token = v;
              }
            }
          }
        } catch (e) {}
      }

      scanStorage(localStorage);
      scanStorage(sessionStorage);

      try {
        const cookies = document.cookie.split(';');
        for (const c of cookies) {
          const parts = c.trim().split('=');
          const k = parts[0] ? parts[0].trim() : '';
          const v = parts.slice(1).join('=');
          if (!k || !v) continue;
          if (!apiKey && (k.toLowerCase().includes('apikey') || k.toLowerCase().includes('api_key'))) {
            apiKey = decodeURIComponent(v).replace(/["']/g, '').trim();
          }
          if (!token && (k.toLowerCase().includes('token') || k.toLowerCase().includes('auth') || k.toLowerCase().includes('jwt'))) {
            token = decodeURIComponent(v).replace(/["']/g, '').trim();
          }
        }
      } catch (e) {}

      return { apiKey, token };
    }

    const creds = getCredentials();

    async function uploadFileToRunningHub(blob, filename, fileType) {
      const ctx = findComfyContext();
      const comfyWin = ctx ? ctx.win : window;
      const comfyOrigin = (comfyWin.location && comfyWin.location.origin) ? comfyWin.location.origin : window.location.origin;

      // 1. Tentar primeiro via ComfyUI API nativa do iframe ou window
      try {
        const apiObj = comfyWin.api || (comfyWin.app && comfyWin.app.api) || (comfyWin.comfyApp && comfyWin.comfyApp.api) || window.api || (window.app && window.app.api);
        if (apiObj && typeof apiObj.uploadFile === 'function') {
          const fileObj = new File([blob], filename, { type: blob.type || 'image/png' });
          const res = await apiObj.uploadFile(fileObj, '', { overwrite: true });
          if (res) {
            if (typeof res === 'string') return res;
            if (res.name) return res.name;
            if (res.fileName) return res.fileName;
            if (res.data && (res.data.name || res.data.fileName)) return res.data.name || res.data.fileName;
          }
        }
        if (apiObj && typeof apiObj.fetchApi === 'function') {
          const fd = new FormData();
          fd.append('image', blob, filename);
          fd.append('overwrite', 'true');
          const resp = await apiObj.fetchApi('/upload/image', { method: 'POST', body: fd });
          if (resp && resp.ok) {
            const d = await resp.json();
            if (d && (d.name || d.fileName)) return d.name || d.fileName;
          }
        }
      } catch (e) {
        console.warn('[VELVY UPLOAD] ComfyUI API nativa erro:', e);
      }

      // 2. Tentar endpoint oficial da RunningHub OpenAPI (/task/openapi/upload)
      const openApiEndpoints = [
        'https://www.runninghub.ai/task/openapi/upload',
        '/task/openapi/upload',
        '/api/task/openapi/upload',
        'https://www.runninghub.cn/task/openapi/upload'
      ];
      let lastErrorMessage = '';
      for (const ep of openApiEndpoints) {
        try {
          const formData = new FormData();
          formData.append('file', blob, filename);
          formData.append('fileType', fileType || 'image');

          const headers = {};
          if (creds.apiKey) {
            formData.append('apiKey', creds.apiKey);
            formData.append('apikey', creds.apiKey);
            headers['apiKey'] = creds.apiKey;
            headers['apikey'] = creds.apiKey;
          }
          if (creds.token) {
            headers['Authorization'] = creds.token.startsWith('Bearer ') ? creds.token : 'Bearer ' + creds.token;
            headers['token'] = creds.token;
          }

          const res = await fetch(ep, {
            method: 'POST',
            body: formData,
            headers: headers,
            credentials: 'include'
          });
          if (res.ok) {
            const data = await res.json();
            if (data.code === 0 || data.success) {
              const uploadedName = (data.data && (data.data.fileName || data.data.name)) || data.fileName || data.name || (typeof data.data === 'string' ? data.data : null);
              if (uploadedName) return uploadedName;
            } else if (data.msg) {
              lastErrorMessage = data.msg;
            }
          } else {
            lastErrorMessage = 'HTTP ' + res.status + ' em ' + ep;
          }
        } catch (err) {
          lastErrorMessage = err.message;
        }
      }

      // 3. Fallback para endpoints HTTP ComfyUI (/upload/image)
      const comfyEndpoints = [
        comfyOrigin + '/upload/image',
        comfyOrigin + '/api/upload/image',
        '/upload/image',
        '/api/upload/image'
      ];
      for (const cep of comfyEndpoints) {
        try {
          const fd = new FormData();
          fd.append('image', blob, filename);
          fd.append('overwrite', 'true');
          const res = await fetch(cep, {
            method: 'POST',
            body: fd,
            credentials: 'include'
          });
          if (res.ok) {
            const data = await res.json();
            if (data && (data.name || data.fileName)) return data.name || data.fileName;
          }
        } catch (err) {}
      }

      throw new Error('Falha no upload do ' + fileType + ' para a RunningHub: ' + (lastErrorMessage || 'Verifique se você está conectado'));
    }
  `;
}

function clearFinishedFaceswapQueue() {
  faceswapQueue = faceswapQueue.filter(t => t.status !== 'done');
  renderFaceswapQueue();
  showToast('Tarefas concluídas removidas da fila');
}

async function processNextInFaceSwapQueue() {
  if (!isFaceswapQueueRunning || isFaceswapPaused) {
    updateFaceswapQueueControls();
    return;
  }

  const nextTask = faceswapQueue.find(t => t.status === 'waiting');
  if (!nextTask) {
    isFaceswapQueueRunning = false;
    updateFaceswapQueueControls();
    showToast('🎉 Todas as tarefas da fila de Face Swap foram concluídas!');
    const statusEl = document.getElementById('faceswap-status-text');
    if (statusEl) statusEl.textContent = 'Fila de Face Swap concluída com sucesso!';
    const barEl = document.getElementById('faceswap-progressBar');
    if (barEl) barEl.style.width = '100%';
    return;
  }

  nextTask.status = 'processing';
  renderFaceswapQueue();
  updateFaceswapQueueControls();

  const statusEl = document.getElementById('faceswap-status-text');
  const barEl = document.getElementById('faceswap-progressBar');
  const previewImg = document.getElementById('faceswap-preview-img');
  const placeholder = document.getElementById('faceswap-placeholder');
  const btnDownload = document.getElementById('btn-download-faceswap');

  const currentIndex = faceswapQueue.indexOf(nextTask) + 1;
  const total = faceswapQueue.length;
  const targetWv = getWebviewForModule('face_swap');

  let gpuTriggered = false;

  try {
    if (barEl) barEl.style.width = '15%';
    if (statusEl) statusEl.textContent = `[${currentIndex}/${total}] Lendo arquivos para ${nextTask.targetName}...`;

    const faceData = await window.electronAPI.readFileBase64(nextTask.facePath);
    const targetData = await window.electronAPI.readFileBase64(nextTask.targetPath);

    if (!targetWv) throw new Error('Webview da Suíte Face Swap não disponível');

    if (barEl) barEl.style.width = '30%';
    if (statusEl) statusEl.textContent = `[${currentIndex}/${total}] Injetando nós ComfyUI (#23 e #17)...`;

    // 0. Captura baseline das saídas ANTES de comutar modo ou limpar (garante que fotos antigas na fila não acionem detecção)
    const baselineUrls = await captureNodeBaselines(targetWv, [371]);

    // 1. Ativa Grupo 1 (Face Swap) e bypassa os outros 3 grupos
    await switchWorkflowMode('face_swap', targetWv);

    const faceNeedsUpload = (cachedUploadedFacePath !== nextTask.facePath || !cachedUploadedFaceServerName);

    // 2. Injeta arquivos no ComfyUI (Nó #23 e Nó #17) com reaproveitamento do upload da modelo fixa
    const injectScript = `
      (async () => {
        function base64ToBlob(base64, mimeType) {
          const byteChars = atob(base64);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
          return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
        }

        ${getCloudUploadScriptHelper()}

        let serverFace = ${faceNeedsUpload ? 'null' : `'${cachedUploadedFaceServerName}'`};
        if (!serverFace) {
          const faceBlob = base64ToBlob('${faceData.base64}', '${faceData.mimeType}');
          serverFace = await uploadFileToRunningHub(faceBlob, '${faceData.name}', 'image');
        }

        const targetBlob = base64ToBlob('${targetData.base64}', '${targetData.mimeType}');
        const serverTarget = await uploadFileToRunningHub(targetBlob, '${targetData.name}', 'image');

        if (!serverFace) throw new Error('Não foi possível obter confirmação de upload do rosto da modelo');
        if (!serverTarget) throw new Error('Não foi possível obter confirmação de upload da foto de destino');

        const graph = getGraphInstance();
        if (!graph) throw new Error('Grafo ComfyUI não localizado na página do RunningHub');

        const ctx = findComfyContext();
        const cWin = ctx ? ctx.win : window;

        function updateNodeImagePreview(node, filename) {
          if (!node || !filename) return;
          try {
            const apiObj = cWin.api || (cWin.app && cWin.app.api);
            let viewUrl = '';
            if (apiObj && typeof apiObj.apiURL === 'function') {
              viewUrl = apiObj.apiURL('/view?filename=' + encodeURIComponent(filename) + '&type=input&subfolder=');
            } else {
              viewUrl = '/view?filename=' + encodeURIComponent(filename) + '&type=input&subfolder=';
            }
            const img = new Image();
            img.onload = () => {
              node.imgs = [img];
              node.image = img;
              if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
              const canvasObj = cWin.LGraphCanvas && (cWin.LGraphCanvas.active_canvas || (cWin.app && cWin.app.canvas));
              if (canvasObj && typeof canvasObj.draw === 'function') {
                try { canvasObj.draw(true, true); } catch (e) {}
              }
            };
            img.src = viewUrl;
          } catch (e) {}
        }

        // Nó 23: Rosto Referência (LoadImage)
        const n23 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(23) : null;
        if (n23) {
          const w = (n23.widgets && n23.widgets.find(x => x.name === 'image')) || (n23.widgets && n23.widgets[0]);
          if (w) {
            w.value = serverFace;
            if (typeof w.callback === 'function') {
              try { w.callback(serverFace); } catch (e) {}
            }
          }
          if (Array.isArray(n23.widgets_values)) {
            n23.widgets_values[0] = serverFace;
          }
          updateNodeImagePreview(n23, serverFace);
        }

        // Nó 17: Imagem Destino (LoadImage)
        const n17 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(17) : null;
        if (n17) {
          const w = (n17.widgets && n17.widgets.find(x => x.name === 'image')) || (n17.widgets && n17.widgets[0]);
          if (w) {
            w.value = serverTarget;
            if (typeof w.callback === 'function') {
              try { w.callback(serverTarget); } catch (e) {}
            }
          }
          if (Array.isArray(n17.widgets_values)) {
            n17.widgets_values[0] = serverTarget;
          }
          updateNodeImagePreview(n17, serverTarget);
        }

        // Limpar saídas anteriores estritamente no nó 371 para detecção limpa sem resíduos
        const n371 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(371) : null;
        if (n371) {
          n371.imgs = null;
          n371.images = null;
          n371.image = null;
          if (Array.isArray(n371.widgets)) {
            n371.widgets.forEach(w => {
              if (w && w.element) {
                try { w.element.src = ''; } catch (e) {}
                w.element = null;
              }
            });
          }
        }
        if (cWin.app && cWin.app.nodeOutputs) {
          delete cWin.app.nodeOutputs[371];
          delete cWin.app.nodeOutputs['371'];
        }
        if (cWin.app && cWin.app.lastNodeOutputs) {
          delete cWin.app.lastNodeOutputs[371];
          delete cWin.app.lastNodeOutputs['371'];
        }

        if (typeof graph.change === 'function') graph.change();
        if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
        const canvasObj = cWin.LGraphCanvas && (cWin.LGraphCanvas.active_canvas || (cWin.app && cWin.app.canvas));
        if (canvasObj && typeof canvasObj.draw === 'function') {
          try { canvasObj.draw(true, true); } catch (e) {}
        }

        return { serverFace, serverTarget };
      })();
    `;

    const injectResult = await targetWv.executeJavaScript(injectScript);
    if (injectResult && injectResult.serverFace) {
      cachedUploadedFacePath = nextTask.facePath;
      cachedUploadedFaceServerName = injectResult.serverFace;
    }

    // 3. Dispara GPU tier (Plus como padrão calibrado)
    if (barEl) barEl.style.width = '50%';
    const tier = document.getElementById('queue-gpu-tier')?.value || appSettings.gpuTier || 'Lite/Plus';
    if (statusEl) statusEl.textContent = `[${currentIndex}/${total}] Disparando GPU (${tier})...`;

    await targetWv.executeJavaScript(`
      (() => {
        ${findTierButtonScript(tier)}
      })();
    `);
    gpuTriggered = true;

    // 4. Aguarda saída estritamente no Nó #371 (PreviewImage individual do Face Swap)
    if (barEl) barEl.style.width = '70%';
    if (statusEl) statusEl.textContent = `[${currentIndex}/${total}] Processando Face Swap na nuvem...`;

    const dataUrl = await waitForImageOutput('Face Swap', [371], 369, statusEl, null, barEl, previewImg, placeholder, btnDownload, targetWv, baselineUrls);

    // 5. Salva imagem localmente
    const saveFilename = `VELVY_FACESWAP_${Date.now()}_${nextTask.taskName.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const downloadRes = await window.electronAPI.downloadVideo({
      url: dataUrl,
      filename: saveFilename,
      outputDir: appSettings.outputDir
    });

    // 6. Cancela tarefa na nuvem para economizar créditos (Trava Zero Créditos no nó 369)
    if (statusEl) statusEl.textContent = `[${currentIndex}/${total}] Salvando créditos: Cancelando Sleep Node #369...`;
    await triggerCloudTaskCancel(targetWv);
    gpuTriggered = false;

    // 7. Atualiza preview na UI e marca tarefa como concluída
    nextTask.status = 'done';
    nextTask.resultPath = downloadRes.path;

    let safePreviewUrl = dataUrl;
    if (!safePreviewUrl || !safePreviewUrl.startsWith('data:image/')) {
      try {
        const fileData = await window.electronAPI.readFileBase64(downloadRes.path);
        if (fileData && fileData.base64) {
          safePreviewUrl = `data:${fileData.mimeType || 'image/png'};base64,${fileData.base64}`;
        }
      } catch (e) {
        console.warn('[VELVY STUDIO] Aviso ao carregar preview do Face Swap:', e);
      }
    }
    nextTask.dataUrl = safePreviewUrl;

    if (previewImg && placeholder) {
      previewImg.src = safePreviewUrl;
      previewImg.style.display = 'block';
      placeholder.style.display = 'none';
    }
    if (btnDownload) {
      btnDownload.disabled = false;
      btnDownload.onclick = () => window.electronAPI.downloadVideo({ url: safePreviewUrl, filename: saveFilename, outputDir: appSettings.outputDir });
    }

    if (barEl) barEl.style.width = '100%';
    if (statusEl) statusEl.textContent = `[${currentIndex}/${total}] Concluído: ${saveFilename}`;
    renderFaceswapQueue();

    // Pausa segura para o RunningHub liberar a GPU na nuvem antes de injetar o próximo lote
    if (statusEl) statusEl.textContent = `[${currentIndex}/${total}] Aguardando liberação da nuvem...`;
    await new Promise(r => setTimeout(r, 4000));
    processNextInFaceSwapQueue();
  } catch (err) {
    console.error(`[VELVY STUDIO] Erro no Face Swap (${nextTask.taskName}):`, err);
    nextTask.status = 'error';
    nextTask.error = err.message;
    if (statusEl) statusEl.textContent = `[${currentIndex}/${total}] Erro: ${err.message}`;
    renderFaceswapQueue();

    if (gpuTriggered) {
      await triggerCloudTaskCancel(targetWv);
      // Avança para a próxima se a GPU já estava rodando
      await new Promise(r => setTimeout(r, 4000));
      processNextInFaceSwapQueue();
    } else {
      // Se nem chegou a disparar a GPU (falha de upload ou injeção), para a fila imediatamente
      isFaceswapQueueRunning = false;
      updateFaceswapQueueControls();
      showToast(`❌ Falha no Face Swap: ${err.message}`);
    }
  }
}

// Fallback para manter compatibilidade com chamadas diretas
async function executeFaceSwapTask() {
  startFaceswapQueue();
}

// 2. EXECUÇÃO: 4K UPSCALE
async function executeUpscaleTask() {
  const imgPath = document.getElementById('upscale-image-path')?.value;
  const taskName = document.getElementById('upscale-task-name')?.value || `Upscale4K_${Date.now()}`;
  const faceDenoise = parseFloat(document.getElementById('range-denoise-face')?.value || '0.08');
  const bgDenoise = parseFloat(document.getElementById('range-denoise-bg')?.value || '0.15');
  const statusEl = document.getElementById('upscale-status-text');
  const barEl = document.getElementById('upscale-progressBar');
  const btnStart = document.getElementById('btn-start-upscale');
  const previewImg = document.getElementById('upscale-preview-img');
  const placeholder = document.getElementById('upscale-placeholder');
  const btnDownload = document.getElementById('btn-download-upscale');

  if (!imgPath) {
    showToast('⚠️ Por favor selecione a imagem da modelo para Upscale!');
    return;
  }

  try {
    if (btnStart) btnStart.disabled = true;
    if (barEl) barEl.style.width = '15%';
    if (statusEl) statusEl.textContent = 'Lendo imagem local...';

    const imgData = await window.electronAPI.readFileBase64(imgPath);

    if (barEl) barEl.style.width = '35%';
    if (statusEl) statusEl.textContent = 'Enviando imagem e ativando Grupo 4K Upscale...';

    const targetWv = getWebviewForModule('upscale');
    // 1. Ativa Grupo 2 (Upscale) e bypassa os outros 3 grupos
    await switchWorkflowMode('upscale', targetWv);

    // 2. Injeta no Nó #314 (LoadImage) e nós 291/294 (Denoise)
    const injectScript = `
      (async () => {
        function base64ToBlob(base64, mimeType) {
          const byteChars = atob(base64);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
          return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
        }

        ${getCloudUploadScriptHelper()}

        const blob = base64ToBlob('${imgData.base64}', '${imgData.mimeType}');
        const serverImg = await uploadFileToRunningHub(blob, '${imgData.name}', 'image');

        const graph = getGraphInstance();
        if (graph) {
          // Nó 314: Foto da Modelo (LoadImage)
          const n314 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(314) : null;
          if (n314) {
            const w = (n314.widgets && n314.widgets.find(x => x.name === 'image')) || (n314.widgets && n314.widgets[0]);
            if (w && serverImg) { w.value = serverImg; if (w.callback) w.callback(serverImg); }
          }

          // Nó 291: Face Denoise
          const n291 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(291) : null;
          if (n291 && n291.widgets && n291.widgets[0]) {
            n291.widgets[0].value = ${faceDenoise};
          }

          // Nó 294: Background Denoise
          const n294 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(294) : null;
          if (n294 && n294.widgets && n294.widgets[0]) {
            n294.widgets[0].value = ${bgDenoise};
          }

          if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
        }

        return { serverImg };
      })();
    `;

    await targetWv.executeJavaScript(injectScript);

    // 3. Dispara GPU tier
    if (barEl) barEl.style.width = '55%';
    const tier = document.getElementById('queue-gpu-tier')?.value || appSettings.gpuTier || 'Lite/Plus';
    if (statusEl) statusEl.textContent = `Disparando GPU (${tier})...`;

    await targetWv.executeJavaScript(`
      (() => {
        ${findTierButtonScript(tier)}
      })();
    `);

    // 4. Aguarda saída no Nó 273 (SaveImage 4K) e cancela sleep node 366
    if (barEl) barEl.style.width = '75%';
    const dataUrl = await waitForImageOutput('4K Upscale', [273], 366, statusEl, null, barEl, previewImg, placeholder, btnDownload, targetWv);

    // 5. Salva imagem localmente
    const saveFilename = `VELVY_4K_UPSCALE_${Date.now()}_${taskName.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const downloadRes = await window.electronAPI.downloadVideo({
      url: dataUrl,
      filename: saveFilename,
      outputDir: appSettings.outputDir
    });

    // 6. Cancela tarefa nuvem (Trava Zero Créditos no nó 366)
    if (statusEl) statusEl.textContent = 'Salvando créditos: Cancelando Sleep Node #366...';
    await triggerCloudTaskCancel(targetWv);

    // 7. Atualiza preview na UI
    let safePreviewUrl = dataUrl;
    if (!safePreviewUrl || !safePreviewUrl.startsWith('data:image/')) {
      try {
        const fileData = await window.electronAPI.readFileBase64(downloadRes.path);
        if (fileData && fileData.base64) {
          safePreviewUrl = `data:${fileData.mimeType || 'image/png'};base64,${fileData.base64}`;
        }
      } catch (e) {
        console.warn('[VELVY STUDIO] Aviso ao carregar preview do 4K Upscale:', e);
      }
    }

    if (previewImg && placeholder) {
      previewImg.src = safePreviewUrl;
      previewImg.style.display = 'block';
      placeholder.style.display = 'none';
    }
    if (btnDownload) {
      btnDownload.disabled = false;
      btnDownload.onclick = () => window.electronAPI.downloadVideo({ url: safePreviewUrl, filename: saveFilename, outputDir: appSettings.outputDir });
    }

    if (barEl) barEl.style.width = '100%';
    if (statusEl) statusEl.textContent = 'Imagem 4K finalizada e salva com sucesso!';
    showToast('💎 4K Cinema Upscale concluído com sucesso!');
  } catch (err) {
    console.error('[VELVY STUDIO] Erro no Upscale 4K:', err);
    if (statusEl) statusEl.textContent = `Erro: ${err.message}`;
    showToast(`❌ Erro no Upscale 4K: ${err.message}`);
    await triggerCloudTaskCancel();
  } finally {
    if (btnStart) btnStart.disabled = false;
  }
}

// 3. EXECUÇÃO: TROCADOR DE ROUPA
async function executeClothesSwapTask() {
  let modelPath = document.getElementById('clothes-model-path')?.value;
  if (!modelPath && fixedFaceModel && fixedFaceModel.path) {
    modelPath = fixedFaceModel.path;
  }
  const piecePath = document.getElementById('clothes-piece-path')?.value;
  const promptText = document.getElementById('clothes-prompt-text')?.value || '';
  const taskName = document.getElementById('clothes-task-name')?.value || `TrocaRoupa_${Date.now()}`;
  const statusEl = document.getElementById('clothes-status-text');
  const barEl = document.getElementById('clothes-progressBar');
  const btnStart = document.getElementById('btn-start-clothes');
  const previewImg = document.getElementById('clothes-preview-img');
  const placeholder = document.getElementById('clothes-placeholder');
  const btnDownload = document.getElementById('btn-download-clothes');

  if (!modelPath || !piecePath) {
    showToast('⚠️ Por favor selecione a foto da modelo (ou fixe uma modelo) e a foto da roupa nova!');
    return;
  }

  try {
    if (btnStart) btnStart.disabled = true;
    if (barEl) barEl.style.width = '15%';
    if (statusEl) statusEl.textContent = 'Lendo imagens locais...';

    const modelData = await window.electronAPI.readFileBase64(modelPath);
    const pieceData = await window.electronAPI.readFileBase64(piecePath);

    if (barEl) barEl.style.width = '35%';
    if (statusEl) statusEl.textContent = 'Enviando roupas e ativando Grupo Trocador de Roupa...';

    const targetWv = getWebviewForModule('clothes_swap');
    // 1. Ativa Grupo 3 (Trocador de Roupa) e bypassa os outros 3 grupos
    await switchWorkflowMode('clothes_swap', targetWv);

    // 2. Injeta no Nó #339 (Folha Modelo), Nó #341 (Roupa Nova) e Nó #348 (Prompt)
    const injectScript = `
      (async () => {
        function base64ToBlob(base64, mimeType) {
          const byteChars = atob(base64);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
          return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
        }

        ${getCloudUploadScriptHelper()}

        const ctx = findComfyContext();
        const comfyWin = ctx ? ctx.win : window;

        function updateNodeImagePreview(node, filename) {
          if (!node || !filename) return;
          try {
            const apiObj = comfyWin.api || (comfyWin.app && comfyWin.app.api);
            let viewUrl = '';
            if (apiObj && typeof apiObj.apiURL === 'function') {
              viewUrl = apiObj.apiURL('/view?filename=' + encodeURIComponent(filename) + '&type=input&subfolder=');
            } else {
              viewUrl = '/view?filename=' + encodeURIComponent(filename) + '&type=input&subfolder=';
            }
            const img = new Image();
            img.onload = () => {
              node.imgs = [img];
              node.image = img;
              if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
              const canvasObj = comfyWin.LGraphCanvas && (comfyWin.LGraphCanvas.active_canvas || (comfyWin.app && comfyWin.app.canvas));
              if (canvasObj && typeof canvasObj.draw === 'function') {
                try { canvasObj.draw(true, true); } catch (e) {}
              }
            };
            img.src = viewUrl;
          } catch (e) {}
        }

        const modelBlob = base64ToBlob('${modelData.base64}', '${modelData.mimeType}');
        const pieceBlob = base64ToBlob('${pieceData.base64}', '${pieceData.mimeType}');

        const serverModel = await uploadFileToRunningHub(modelBlob, '${modelData.name}', 'image');
        const serverPiece = await uploadFileToRunningHub(pieceBlob, '${pieceData.name}', 'image');

        const graph = getGraphInstance();
        if (graph) {
          // Nó 339: Folha do Personagem (LoadImage)
          const n339 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(339) : null;
          if (n339) {
            const w = (n339.widgets && n339.widgets.find(x => x.name === 'image')) || (n339.widgets && n339.widgets[0]);
            if (w && serverModel) {
              w.value = serverModel;
              if (typeof w.callback === 'function') {
                try { w.callback(serverModel); } catch (e) {}
              }
            }
            if (Array.isArray(n339.widgets_values)) {
              n339.widgets_values[0] = serverModel;
            }
            updateNodeImagePreview(n339, serverModel);
          }

          // Nó 341: Roupa Nova (LoadImage)
          const n341 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(341) : null;
          if (n341) {
            const w = (n341.widgets && n341.widgets.find(x => x.name === 'image')) || (n341.widgets && n341.widgets[0]);
            if (w && serverPiece) {
              w.value = serverPiece;
              if (typeof w.callback === 'function') {
                try { w.callback(serverPiece); } catch (e) {}
              }
            }
            if (Array.isArray(n341.widgets_values)) {
              n341.widgets_values[0] = serverPiece;
            }
            updateNodeImagePreview(n341, serverPiece);
          }

          // Nó 348: Prompt de estilo/roupa
          const customPrompt = ${JSON.stringify(promptText)};
          const n348 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(348) : null;
          if (n348 && n348.widgets && customPrompt && customPrompt.trim().length > 0) {
            const w = n348.widgets.find(x => x.name === 'text') || n348.widgets[0];
            if (w) w.value = customPrompt;
            if (Array.isArray(n348.widgets_values)) n348.widgets_values[0] = customPrompt;
          }

          // Limpar resíduos anteriores nos nós de saída (Nó 356 e Nó 340) para detecção de baseline limpa
          [356, 340].forEach(id => {
            const n = (typeof graph.getNodeById === 'function') ? graph.getNodeById(id) : null;
            if (n) {
              n.imgs = null;
              n.images = null;
              n.image = null;
              if (Array.isArray(n.widgets)) {
                n.widgets.forEach(w => {
                  if (w && w.element) {
                    try { w.element.src = ''; } catch (e) {}
                    w.element = null;
                  }
                });
              }
            }
            if (comfyWin.app && comfyWin.app.nodeOutputs) {
              delete comfyWin.app.nodeOutputs[id];
              delete comfyWin.app.nodeOutputs[String(id)];
            }
            if (comfyWin.app && comfyWin.app.lastNodeOutputs) {
              delete comfyWin.app.lastNodeOutputs[id];
              delete comfyWin.app.lastNodeOutputs[String(id)];
            }
          });

          if (typeof graph.change === 'function') graph.change();
          if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
          const canvasObj = comfyWin.LGraphCanvas && (comfyWin.LGraphCanvas.active_canvas || (comfyWin.app && comfyWin.app.canvas));
          if (canvasObj && typeof canvasObj.draw === 'function') {
            try { canvasObj.draw(true, true); } catch (e) {}
          }
        }

        return { serverModel, serverPiece };
      })();
    `;

    await targetWv.executeJavaScript(injectScript);

    // 3. Dispara GPU tier
    if (barEl) barEl.style.width = '55%';
    const tier = document.getElementById('queue-gpu-tier')?.value || appSettings.gpuTier || 'Lite/Plus';
    if (statusEl) statusEl.textContent = `Disparando GPU (${tier})...`;

    await targetWv.executeJavaScript(`
      (() => {
        ${findTierButtonScript(tier)}
      })();
    `);

    // 4. Aguarda saída no Nó 356 (SaveImage) ou Nó 340 (PreviewImage) e cancela sleep node 362
    if (barEl) barEl.style.width = '75%';
    const dataUrl = await waitForImageOutput('Troca de Roupa', [356, 340], 362, statusEl, null, barEl, previewImg, placeholder, btnDownload, targetWv);

    // 5. Salva imagem localmente
    const saveFilename = `VELVY_OUTFIT_${Date.now()}_${taskName.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    const downloadRes = await window.electronAPI.downloadVideo({
      url: dataUrl,
      filename: saveFilename,
      outputDir: appSettings.outputDir
    });

    // 6. Cancela tarefa nuvem (Trava Zero Créditos no nó 362)
    if (statusEl) statusEl.textContent = 'Salvando créditos: Cancelando Sleep Node #362...';
    await triggerCloudTaskCancel(targetWv);

    // 7. Atualiza preview na UI
    let safePreviewUrl = dataUrl;
    if (!safePreviewUrl || !safePreviewUrl.startsWith('data:image/')) {
      try {
        const fileData = await window.electronAPI.readFileBase64(downloadRes.path);
        if (fileData && fileData.base64) {
          safePreviewUrl = `data:${fileData.mimeType || 'image/png'};base64,${fileData.base64}`;
        }
      } catch (e) {
        console.warn('[VELVY STUDIO] Aviso ao carregar preview da Troca de Roupa:', e);
      }
    }

    if (previewImg && placeholder) {
      previewImg.src = safePreviewUrl;
      previewImg.style.display = 'block';
      placeholder.style.display = 'none';
    }
    if (btnDownload) {
      btnDownload.disabled = false;
      btnDownload.onclick = () => window.electronAPI.downloadVideo({ url: safePreviewUrl, filename: saveFilename, outputDir: appSettings.outputDir });
    }

    if (barEl) barEl.style.width = '100%';
    if (statusEl) statusEl.textContent = 'Look trocado e salvo com sucesso!';
    showToast('👗 Troca de roupa concluída com sucesso!');
  } catch (err) {
    console.error('[VELVY STUDIO] Erro na troca de roupa:', err);
    if (statusEl) statusEl.textContent = `Erro: ${err.message}`;
    showToast(`❌ Erro na troca de roupa: ${err.message}`);
    await triggerCloudTaskCancel(targetWv);
  } finally {
    if (btnStart) btnStart.disabled = false;
  }
}

// Monitor e extrator especializado de MÚLTIPLAS imagens individuais para o Carrossel Multi-Pose
// Garante que NENHUMA grade/colagem seja salva, extraindo cada pose individualmente em resolução máxima.
async function waitForCarouselMultiImages(saveNodeIds, sleepNodeId, statusEl, progressBarEl, explicitWv, explicitBaselines, expectedMinCount = 1) {
  const wv = explicitWv || getWebviewForModule('carousel');
  const startTime = Date.now();
  const maxTimeoutMs = 360000; // 6 minutos para carrossel multi-pose
  const checkIntervalMs = 2500;
  // Trava anti-duplicação: 25 segundos
  const minWaitSeconds = 25;

  let baselineUrls = explicitBaselines;
  if (!baselineUrls || !Array.isArray(baselineUrls)) {
    baselineUrls = await captureNodeBaselines(wv, saveNodeIds);
  }

  let lastImageCount = 0;
  let stableCountTicks = 0;

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      if (isCarouselCancelled) {
        clearInterval(interval);
        return reject(new Error('Geração do carrossel cancelada pelo usuário'));
      }

      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

      if (Date.now() - startTime > maxTimeoutMs) {
        clearInterval(interval);
        return reject(new Error('Tempo limite excedido aguardando fotos do carrossel na nuvem.'));
      }

      if (elapsedSec < minWaitSeconds) {
        if (statusEl) statusEl.textContent = `[Carrossel] Renderizando poses na nuvem (${elapsedSec}s / ${minWaitSeconds}s trava anti-duplicação)...`;
        return;
      }

      if (statusEl) statusEl.textContent = `[Carrossel] Gerando poses (${elapsedSec}s decorridos)... Monitorando nós ${saveNodeIds.join(', ')}...`;

      const pollScript = `
        (async () => {
          try {
            ${getComfyGraphFinderScript()}
            const graph = getGraphInstance();
            const ctx = findComfyContext();
            if (!graph && !ctx) return { found: false, count: 0 };

            const ids = ${JSON.stringify(saveNodeIds)};
            const baselines = ${JSON.stringify(baselineUrls || [])};

            function normalizeImageId(str) {
              if (!str) return '';
              let s = str.toString().toLowerCase();
              const m = s.match(/filename=([^&]+)/);
              if (m) s = decodeURIComponent(m[1]);
              s = s.split('?')[0].split('#')[0];
              const parts = s.split('/').pop().split(String.fromCharCode(92)).pop();
              return (parts || '').trim();
            }

            function isAlreadyInBaselines(target) {
              if (!target || !baselines || baselines.length === 0) return false;
              const normTarget = normalizeImageId(target);
              const rawTarget = target.toString().toLowerCase().trim();

              return baselines.some(b => {
                if (!b) return false;
                const normB = normalizeImageId(b);
                const rawB = b.toString().toLowerCase().trim();
                if (normTarget && normB && normTarget === normB) return true;
                if (rawTarget === rawB) return true;
                if (normTarget && normTarget.length > 3 && rawB.includes(normTarget)) return true;
                if (normB && normB.length > 3 && rawTarget.includes(normB)) return true;
                return false;
              });
            }

            // Coleta todas as imagens novas geradas nos nós 404 e 405
            const candidateImages = new Map();

            const comfyWin = ctx ? ctx.win : window;
            let comfyOrigin = window.location.origin;
            try {
              if (comfyWin && comfyWin.location && typeof comfyWin.location.origin === 'string') {
                comfyOrigin = comfyWin.location.origin;
              }
            } catch (e) {}

            const apiObj = comfyWin && (comfyWin.api || (comfyWin.app && comfyWin.app.api));

            ids.forEach(id => {
              const node = (graph && typeof graph.getNodeById === 'function') ? graph.getNodeById(id) : null;

              // 1. nodeOutputs do ComfyUI (fonte primária e mais precisa)
              if (ctx && ctx.app) {
                const outputs = (ctx.app.nodeOutputs && (ctx.app.nodeOutputs[id] || ctx.app.nodeOutputs[String(id)])) ||
                                (ctx.app.lastNodeOutputs && (ctx.app.lastNodeOutputs[id] || ctx.app.lastNodeOutputs[String(id)]));
                if (outputs && Array.isArray(outputs.images)) {
                  outputs.images.forEach(item => {
                    const fn = typeof item === 'string' ? item : (item && item.filename);
                    if (fn && !isAlreadyInBaselines(fn)) {
                      const sub = (item && item.subfolder) ? item.subfolder : '';
                      const type = (item && item.type) ? item.type : 'output';
                      let viewUrl = '';
                      if (apiObj && typeof apiObj.apiURL === 'function') {
                        try { viewUrl = apiObj.apiURL('/view?filename=' + encodeURIComponent(fn) + '&type=' + encodeURIComponent(type) + '&subfolder=' + encodeURIComponent(sub)); } catch (e) {}
                      }
                      if (!viewUrl) viewUrl = comfyOrigin + '/view?filename=' + encodeURIComponent(fn) + '&type=' + encodeURIComponent(type) + '&subfolder=' + encodeURIComponent(sub);
                      const key = normalizeImageId(fn);
                      if (key && !candidateImages.has(key)) {
                        candidateImages.set(key, { filename: fn, url: viewUrl, subfolder: sub, type });
                      }
                    }
                  });
                }
              }

              // 2. node.images (metadados do nó)
              if (node && Array.isArray(node.images)) {
                node.images.forEach(item => {
                  const fn = typeof item === 'string' ? item : (item && item.filename);
                  if (fn && !isAlreadyInBaselines(fn)) {
                    const sub = (item && item.subfolder) ? item.subfolder : '';
                    const type = (item && item.type) ? item.type : 'output';
                    let viewUrl = '';
                    if (apiObj && typeof apiObj.apiURL === 'function') {
                      try { viewUrl = apiObj.apiURL('/view?filename=' + encodeURIComponent(fn) + '&type=' + encodeURIComponent(type) + '&subfolder=' + encodeURIComponent(sub)); } catch (e) {}
                    }
                    if (!viewUrl) viewUrl = comfyOrigin + '/view?filename=' + encodeURIComponent(fn) + '&type=' + encodeURIComponent(type) + '&subfolder=' + encodeURIComponent(sub);
                    const key = normalizeImageId(fn);
                    if (key && !candidateImages.has(key)) {
                      candidateImages.set(key, { filename: fn, url: viewUrl, subfolder: sub, type });
                    }
                  }
                });
              }

              // 3. node.imgs (elementos HTMLImageElement individuais)
              if (node && Array.isArray(node.imgs)) {
                node.imgs.forEach(img => {
                  if (img && img.src && !isAlreadyInBaselines(img.src)) {
                    const key = normalizeImageId(img.src) || img.src;
                    if (key && !candidateImages.has(key)) {
                      candidateImages.set(key, { filename: key, url: img.src });
                    }
                  }
                });
              }
            });

            // Verifica se a execução alcançou o nó de sleep (#386) ou finalizou
            const isSleeping = (ctx && ctx.app && (ctx.app.runningNodeId === 386 || ctx.app.runningNodeId === '386')) ||
                               Boolean(document.body && document.body.innerText && document.body.innerText.includes('ESPERA CRÉDITOS INFINITOS'));

            const foundCount = candidateImages.size;
            return {
              count: foundCount,
              isSleeping: isSleeping,
              items: Array.from(candidateImages.values())
            };
          } catch (e) {
            return { count: 0, error: e.message };
          }
        })();
      `;

      try {
        const pollRes = await wv.executeJavaScript(pollScript);
        if (pollRes && pollRes.error) {
          console.warn('[VELVY STUDIO] Poll carrossel:', pollRes.error);
        }

        const count = pollRes ? pollRes.count : 0;
        const isSleeping = pollRes ? pollRes.isSleeping : false;

        if (count > 0) {
          if (count === lastImageCount) {
            stableCountTicks++;
          } else {
            stableCountTicks = 0;
            lastImageCount = count;
          }

          if (statusEl) {
            statusEl.textContent = `[Carrossel] ${count} pose(s) detectada(s)... (${isSleeping ? 'Sleep #386 alcançado!' : 'Aguardando lote completo...'})`;
          }

          // Se alcançou o nó de Sleep (#386) OU atingiu todas as poses configuradas OU estabilizou por 6 ciclos (15s)
          const isComplete = isSleeping || (count >= expectedMinCount) || (stableCountTicks >= 6 && count >= 1);

          if (isComplete) {
            clearInterval(interval);
            if (statusEl) statusEl.textContent = `[Carrossel] Extraindo ${count} fotos individuais em alta resolução...`;

            // Extrai cada foto individualmente via fetch com credenciais para resolução total (NÃO grade)
            const extractAllScript = `
              (async () => {
                const items = ${JSON.stringify(pollRes.items || [])};
                const results = [];

                for (let i = 0; i < items.length; i++) {
                  const it = items[i];
                  try {
                    let dataUrl = null;
                    if (it.url) {
                      try {
                        const isBlob = it.url.startsWith('blob:');
                        const res = await fetch(it.url, isBlob ? {} : { credentials: 'include' });
                        if (res && res.ok) {
                          const blob = await res.blob();
                          const reader = new FileReader();
                          dataUrl = await new Promise((resB64, rejB64) => {
                            reader.onloadend = () => resB64(reader.result);
                            reader.onerror = () => rejB64(new Error('FileReader error'));
                            reader.readAsDataURL(blob);
                          });
                        }
                      } catch (fetchErr) {}
                    }

                    if (!dataUrl) {
                      dataUrl = it.url;
                    }

                    if (dataUrl && dataUrl.length > 50) {
                      results.push({
                        index: i,
                        filename: it.filename || ('carrossel_' + (i + 1) + '.png'),
                        dataUrl: dataUrl
                      });
                    }
                  } catch (itemErr) {}
                }

                return results;
              })();
            `;

            const extractedImages = await wv.executeJavaScript(extractAllScript);
            if (extractedImages && extractedImages.length > 0) {
              return resolve(extractedImages);
            } else {
              return reject(new Error('Falha ao extrair bytes das imagens do carrossel.'));
            }
          }
        }
      } catch (err) {
        console.warn('[VELVY STUDIO] Erro no poll de carrossel:', err.message);
      }
    }, checkIntervalMs);
  });
}

// 4. EXECUÇÃO: GERADOR DE CARROSSEL MULTI-POSE
// Salva TODAS as fotos geradas individualmente (NÃO a grade) e popula a galeria
async function executeCarouselTask() {
  let mainPath = document.getElementById('carousel-main-path')?.value;
  const posesText = document.getElementById('carousel-poses-text')?.value || '';
  const taskName = document.getElementById('carousel-task-name')?.value || `Carrossel_${Date.now()}`;
  const statusEl = document.getElementById('carousel-status-text');
  const barEl = document.getElementById('carousel-progressBar');
  const btnStart = document.getElementById('btn-start-carousel');
  const btnCancel = document.getElementById('btn-cancel-carousel');
  const previewImg = document.getElementById('carousel-preview-img');
  const placeholder = document.getElementById('carousel-placeholder');
  const btnDownload = document.getElementById('btn-download-carousel');
  const btnDownloadAll = document.getElementById('btn-download-all-carousel');
  const countBadge = document.getElementById('carousel-count-badge');
  const checkMark = document.getElementById('carousel-check');

  // Fallback inteligente para modelo fixada caso o campo esteja vazio
  if (!mainPath && fixedFaceModel && fixedFaceModel.path) {
    mainPath = fixedFaceModel.path;
    const p = document.getElementById('carousel-main-path');
    if (p) p.value = mainPath;
    const l = document.getElementById('carousel-main-label');
    if (l) l.textContent = `Modelo: ${fixedFaceModel.name}`;
    const t = document.getElementById('carouselMainThumb');
    if (t && fixedFaceModel.dataUrl) {
      t.src = fixedFaceModel.dataUrl;
      t.style.display = 'block';
    }
    showToast(`📸 Usando modelo fixada "${fixedFaceModel.name}" no Carrossel!`);
  }

  if (!mainPath) {
    showToast('⚠️ Por favor selecione a foto principal da modelo para o carrossel!');
    return;
  }

  const posesLines = (posesText || '').split('\n').map(l => l.trim()).filter(Boolean);
  const countPoses = posesLines.length > 0 ? posesLines.length : 1;

  isCarouselCancelled = false;
  const targetWv = getWebviewForModule('carousel');

  try {
    if (btnStart) btnStart.disabled = true;
    if (btnCancel) btnCancel.style.display = 'inline-flex';
    if (barEl) barEl.style.width = '15%';
    if (statusEl) statusEl.textContent = 'Lendo foto principal local...';

    const mainData = await window.electronAPI.readFileBase64(mainPath);

    if (barEl) barEl.style.width = '30%';
    if (statusEl) statusEl.textContent = `Ativando Grupo Carrossel (${countPoses} poses configuradas)...`;

    // 1. Ativa Grupo 6 (Carrossel) e bypassa os outros grupos
    await switchWorkflowMode('carousel', targetWv);

    // 2. Injeta no Nó #393 (Foto Principal) e Nó #391 (Poses 1 por linha)
    if (barEl) barEl.style.width = '45%';
    if (statusEl) statusEl.textContent = 'Enviando foto e configurando nós ComfyUI (#393 e #391)...';

    const mainNeedsUpload = (!cachedUploadedCarouselMainServerName || cachedUploadedCarouselMainPath !== mainPath);

    const injectScript = `
      (async () => {
        function base64ToBlob(base64, mimeType) {
          const byteChars = atob(base64);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
          return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
        }

        ${getCloudUploadScriptHelper()}

        let serverMain = ${mainNeedsUpload ? 'null' : `'${cachedUploadedCarouselMainServerName}'`};
        if (!serverMain) {
          const mainBlob = base64ToBlob('${mainData.base64}', '${mainData.mimeType}');
          serverMain = await uploadFileToRunningHub(mainBlob, '${mainData.name}', 'image');
        }

        if (!serverMain) throw new Error('Não foi possível obter confirmação de upload da foto principal do carrossel');

        ${getComfyGraphFinderScript()}
        const ctx = findComfyContext();
        const graph = getGraphInstance();
        if (!graph) throw new Error('Grafo ComfyUI não localizado na página do RunningHub');

        const cWin = ctx ? ctx.win : window;

        function updateNodeImagePreview(node, filename) {
          if (!node || !filename) return;
          try {
            const apiObj = cWin.api || (cWin.app && cWin.app.api);
            let viewUrl = '';
            if (apiObj && typeof apiObj.apiURL === 'function') {
              viewUrl = apiObj.apiURL('/view?filename=' + encodeURIComponent(filename) + '&type=input&subfolder=');
            } else {
              viewUrl = '/view?filename=' + encodeURIComponent(filename) + '&type=input&subfolder=';
            }
            const img = new Image();
            img.onload = () => {
              node.imgs = [img];
              node.image = img;
              if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
              const canvasObj = cWin.LGraphCanvas && (cWin.LGraphCanvas.active_canvas || (cWin.app && cWin.app.canvas));
              if (canvasObj && typeof canvasObj.draw === 'function') {
                try { canvasObj.draw(true, true); } catch (e) {}
              }
            };
            img.src = viewUrl;
          } catch (e) {}
        }

        if (graph) {
          // Nó 393: Foto Principal (LoadImage)
          const n393 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(393) : null;
          if (n393) {
            const w = (n393.widgets && n393.widgets.find(x => x.name === 'image')) || (n393.widgets && n393.widgets[0]);
            if (w) {
              w.value = serverMain;
              if (typeof w.callback === 'function') {
                try { w.callback(serverMain); } catch (e) {}
              }
            }
            if (Array.isArray(n393.widgets_values)) {
              n393.widgets_values[0] = serverMain;
            }
            updateNodeImagePreview(n393, serverMain);
          }

          // Nó 391: Poses (easy promptLine)
          const n391 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(391) : null;
          if (n391 && n391.widgets && n391.widgets[0]) {
            n391.widgets[0].value = ${JSON.stringify(posesText.trim())};
            if (typeof n391.widgets[0].callback === 'function') {
              try { n391.widgets[0].callback(n391.widgets[0].value); } catch (e) {}
            }
            // Configura start_index e max_rows para o número exato de poses
            if (n391.widgets[1]) n391.widgets[1].value = 0;
            if (n391.widgets[2]) n391.widgets[2].value = ${countPoses};
            if (Array.isArray(n391.widgets_values)) {
              n391.widgets_values[0] = ${JSON.stringify(posesText.trim())};
              n391.widgets_values[1] = 0;
              n391.widgets_values[2] = ${countPoses};
            }
          }

          // Nó 396: Protege template de TRAVA + pose
          const n396 = (typeof graph.getNodeById === 'function') ? graph.getNodeById(396) : null;
          if (n396 && n396.widgets && n396.widgets[0] && !n396.widgets[0].value) {
            n396.widgets[0].value = 'Edit this photo: keep the same woman with the exact same face, the same outfit, the same location and the same lighting. Both eyes open, symmetrical, natural, looking in the same direction. Camera framing stays the same. Make her pose and expression clearly different from the reference photo: ';
          }

          // Limpa saídas anteriores dos nós 404 e 405 para evitar falso-positivo
          [404, 405].forEach(id => {
            const n = (typeof graph.getNodeById === 'function') ? graph.getNodeById(id) : null;
            if (n) {
              n.imgs = [];
              n.image = null;
              n.images = [];
              if (Array.isArray(n.widgets)) {
                n.widgets.forEach(w => {
                  if (w && w.element) {
                    try { w.element.src = ''; } catch (e) {}
                    w.element = null;
                  }
                });
              }
            }
            if (cWin.app && cWin.app.nodeOutputs) {
              delete cWin.app.nodeOutputs[id];
              delete cWin.app.nodeOutputs[String(id)];
            }
            if (cWin.app && cWin.app.lastNodeOutputs) {
              delete cWin.app.lastNodeOutputs[id];
              delete cWin.app.lastNodeOutputs[String(id)];
            }
          });

          if (typeof graph.change === 'function') graph.change();
          if (typeof graph.setDirtyCanvas === 'function') graph.setDirtyCanvas(true, true);
          const canvasObj = cWin.LGraphCanvas && (cWin.LGraphCanvas.active_canvas || (cWin.app && cWin.app.canvas));
          if (canvasObj && typeof canvasObj.draw === 'function') {
            try { canvasObj.draw(true, true); } catch (e) {}
          }
        }

        return { serverMain };
      })();
    `;

    const injectResult = await targetWv.executeJavaScript(injectScript);
    if (injectResult && injectResult.serverMain) {
      cachedUploadedCarouselMainPath = mainPath;
      cachedUploadedCarouselMainServerName = injectResult.serverMain;
    }

    // Captura baselines antes de disparar a GPU
    const baselineUrls = await captureNodeBaselines(targetWv, [404, 405]);

    // 3. Dispara GPU tier
    if (barEl) barEl.style.width = '55%';
    const tier = document.getElementById('queue-gpu-tier')?.value || appSettings.gpuTier || 'Lite/Plus';
    if (statusEl) statusEl.textContent = `Disparando GPU (${tier})...`;

    await targetWv.executeJavaScript(`
      (() => {
        ${findTierButtonScript(tier)}
      })();
    `);

    // 4. Aguarda TODAS as fotos individuais nos Nós 404 e 405
    if (barEl) barEl.style.width = '70%';
    const extractedImages = await waitForCarouselMultiImages([404, 405], 386, statusEl, barEl, targetWv, baselineUrls, countPoses);

    // 5. Cancela tarefa nuvem IMEDIATAMENTE (Trava Zero Créditos no nó 386)
    if (statusEl) statusEl.textContent = 'Salvando créditos: Cancelando Sleep Node #386...';
    await triggerCloudTaskCancel(targetWv);

    // 6. Salva CADA UMA das fotos individuais no disco (NÃO grade/colagem)
    if (barEl) barEl.style.width = '85%';
    const savedPhotos = [];
    const timestamp = Date.now();
    const safeTaskName = taskName.replace(/[^a-zA-Z0-9_-]/g, '_');

    for (let i = 0; i < extractedImages.length; i++) {
      const it = extractedImages[i];
      const poseNum = i + 1;
      const saveFilename = `VELVY_CARROSSEL_${timestamp}_${safeTaskName}_pose_${poseNum}.png`;

      if (statusEl) statusEl.textContent = `Salvando pose ${poseNum} de ${extractedImages.length} no disco...`;

      const downloadRes = await window.electronAPI.downloadVideo({
        url: it.dataUrl,
        filename: saveFilename,
        outputDir: appSettings.outputDir
      });

      savedPhotos.push({
        poseNum,
        filename: saveFilename,
        path: downloadRes?.path,
        dataUrl: it.dataUrl,
        poseDesc: posesLines[i] || `Pose ${poseNum}`
      });
    }

    // 7. Popula a interface com a foto ativa e galeria de miniaturas de todas as poses
    if (savedPhotos.length > 0) {
      if (previewImg && placeholder) {
        previewImg.src = savedPhotos[0].dataUrl;
        previewImg.style.display = 'block';
        placeholder.style.display = 'none';
      }

      if (btnDownload) {
        btnDownload.disabled = false;
        btnDownload.textContent = `⤓　Baixar Pose 1 (${savedPhotos[0].filename})`;
        btnDownload.onclick = () => window.electronAPI.downloadVideo({
          url: savedPhotos[0].dataUrl,
          filename: savedPhotos[0].filename,
          outputDir: appSettings.outputDir
        });
      }

      // Popula miniatura de todas as poses no container de galeria
      const galleryContainer = document.getElementById('carousel-gallery-container');
      if (galleryContainer) {
        galleryContainer.innerHTML = '';
        savedPhotos.forEach((photo, idx) => {
          const thumb = document.createElement('div');
          thumb.className = `carousel-thumb-item ${idx === 0 ? 'active' : ''}`;
          thumb.setAttribute('data-index', idx);
          thumb.setAttribute('title', `Pose ${photo.poseNum}: ${photo.poseDesc}`);
          thumb.innerHTML = `
            <img src="${photo.dataUrl}" alt="Pose ${photo.poseNum}">
            <div style="font-size:10px;text-align:center;padding:2px;background:rgba(0,0,0,0.6);color:#c4a7e7;font-weight:600;">Pose ${photo.poseNum}</div>
          `;

          thumb.addEventListener('click', () => {
            document.querySelectorAll('.carousel-thumb-item').forEach(t => t.classList.remove('active'));
            thumb.classList.add('active');
            if (previewImg) previewImg.src = photo.dataUrl;
            if (btnDownload) {
              btnDownload.textContent = `⤓　Baixar Pose ${photo.poseNum}`;
              btnDownload.onclick = () => window.electronAPI.downloadVideo({
                url: photo.dataUrl,
                filename: photo.filename,
                outputDir: appSettings.outputDir
              });
            }
          });

          galleryContainer.appendChild(thumb);
        });
        galleryContainer.style.display = 'grid';
      }

      // Ativa botão de baixar todas as poses
      if (btnDownloadAll) {
        btnDownloadAll.style.display = 'block';
        if (countBadge) countBadge.textContent = savedPhotos.length;
        btnDownloadAll.onclick = async () => {
          for (const sp of savedPhotos) {
            await window.electronAPI.downloadVideo({
              url: sp.dataUrl,
              filename: sp.filename,
              outputDir: appSettings.outputDir
            });
          }
          showToast(`💾 Todas as ${savedPhotos.length} poses salvas na pasta!`);
        };
      }

      if (checkMark) checkMark.style.display = 'inline-block';
    }

    if (barEl) barEl.style.width = '100%';
    if (statusEl) statusEl.textContent = `✓ ${savedPhotos.length} fotos do carrossel salvas individualmente na pasta!`;
    showToast(`📸 ${savedPhotos.length} fotos do carrossel geradas e salvas individualmente!`);
  } catch (err) {
    console.error('[VELVY STUDIO] Erro no carrossel:', err);
    if (statusEl) statusEl.textContent = `Erro: ${err.message}`;
    showToast(`❌ Erro no carrossel: ${err.message}`);
    await triggerCloudTaskCancel(targetWv);
  } finally {
    if (btnStart) btnStart.disabled = false;
    if (btnCancel) btnCancel.style.display = 'none';
  }
}

// Helper para injetar o script de detecção precisa do botão de tier
function findTierButtonScript(tier) {
  return `
    const tier = '${tier}';
    let tierKeyword = 'plus';
    if (tier.includes('Standard')) tierKeyword = 'standard';
    if (tier.includes('Ultra')) tierKeyword = 'ultra';

    const BLACKLIST = ['publicar', 'publish', 'assinar', 'subscribe', 'plano', 'plan', 'upgrade', 'benefício', 'beneficio', 'salvar', 'save', 'cancelar'];
    function isBad(t) { return BLACKLIST.some(w => t.includes(w)); }

    function dispatchFullClick(el) {
      if (!el) return;
      try {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        if (typeof el.click === 'function') el.click();
      } catch (e) { try { el.click(); } catch (err) {} }
    }

    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], .ant-btn'));
    const execButtons = allButtons.filter(b => {
      const t = (b.innerText || b.textContent || '').trim().toLowerCase();
      if (isBad(t)) return false;
      const rect = b.getBoundingClientRect();
      return (t === 'executar' || t.includes('executar')) && rect.top < 130 && rect.width > 20 && rect.height > 15;
    });

    execButtons.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

    let target = null;
    if (execButtons.length >= 3) {
      if (tierKeyword === 'standard') target = execButtons[0];
      else if (tierKeyword === 'plus') target = execButtons[1];
      else if (tierKeyword === 'ultra') target = execButtons[2];
    } else if (execButtons.length === 2) {
      target = tierKeyword === 'standard' ? execButtons[0] : execButtons[1];
    } else if (execButtons.length === 1) {
      target = execButtons[0];
    }

    if (target) {
      dispatchFullClick(target);
    } else if (window.app && typeof window.app.queuePrompt === 'function') {
      window.app.queuePrompt(0);
    }
  `;
}
