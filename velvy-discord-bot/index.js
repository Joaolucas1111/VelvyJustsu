/**
 * VELVY STUDIO — DISCORD SALES BOT & LICENSE SERVER
 * Sistema de Vendas, Abertura de Tickets, Gerador de Chaves com Bloqueio First-Use HWID
 * e Painel Web Administrativo em tempo real
 */

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  MessageFlags,
  Events
} = require('discord.js');

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Evita encerramento abrupto em erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
});

// 1. CARREGAMENTO DE CONFIGURAÇÕES & BANCO DE DADOS
const configPath = path.join(__dirname, 'config.json');
const dbPath = path.join(__dirname, 'database.json');
const panelConfigPath = path.join(__dirname, 'panel.json');

function loadPanelConfig() {
  if (fs.existsSync(panelConfigPath)) {
    try {
      return JSON.parse(fs.readFileSync(panelConfigPath, 'utf-8'));
    } catch (e) {
      console.error('[ERRO] Falha ao ler panel.json:', e.message);
    }
  }
  return null;
}

let config = {
  token: '',
  clientId: '',
  guildId: '',
  adminUserId: '',
  adminRoleId: '',
  ticketCategoryId: '',
  apiPort: 7777,
  serverSecret: 'VELVY_MASTER_SECRET_SECURITY_PROD_2026'
};

if (fs.existsSync(configPath)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
  } catch (e) {
    console.error('[ERRO] Falha ao ler config.json:', e);
  }
}

let database = { keys: {}, tickets: {} };
if (fs.existsSync(dbPath)) {
  try {
    database = { ...database, ...JSON.parse(fs.readFileSync(dbPath, 'utf-8')) };
  } catch (e) {
    console.error('[ERRO] Falha ao ler database.json:', e);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(database, null, 2), 'utf-8');
  } catch (e) {
    console.error('[ERRO] Falha ao salvar database.json:', e);
  }
}

// 2. UTILITÁRIOS CRIPTOGRÁFICOS
function generateRandomKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sem O, 0, I, 1 para evitar confusão de leitura
  function seg(len) {
    let s = '';
    for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }
  return `VELVY-${seg(4)}-${seg(4)}-${seg(4)}-${seg(4)}`;
}

function createLicenseToken(key, hwid, expiresAt, plan) {
  const payload = `${key}:${hwid}:${expiresAt}:${plan}`;
  return crypto.createHmac('sha256', config.serverSecret).update(payload).digest('hex');
}

function verifyLicenseToken(key, hwid, expiresAt, plan, token) {
  const expected = createLicenseToken(key, hwid, expiresAt, plan);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

// 3. SERVIDOR HTTP DA API DE LICENCIAMENTO (REST) & PAINEL WEB ADMIN
const app = express();
app.use(cors());
app.use(express.json());

// Middleware de autenticação para o Web Admin
function checkAdminSecret(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (req.query.secret || '').trim();
  if (token && token === config.serverSecret) {
    return next();
  }
  return res.status(403).json({ success: false, error: 'Acesso negado: Segredo de administração inválido.' });
}

// Servir o Painel Web de Administração (visualização de chaves, hwid, datas, geração e cancelamento)
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Endpoint público para consulta de versão e auto-update
app.get('/version.json', (req, res) => {
  const vPath = path.join(__dirname, '..', 'version.json');
  if (fs.existsSync(vPath)) {
    return res.sendFile(vPath);
  }
  return res.json({ version: '1.0.0', title: 'Velvy Studio Pro', notes: 'Versão estável' });
});

// Endpoint de Ativação do Cliente (Chamado pelo Velvy Studio no PC do comprador)
app.post('/api/activate', (req, res) => {
  const { key, hwid } = req.body;

  if (!key || !hwid) {
    return res.status(400).json({ success: false, error: 'Chave e HWID são obrigatórios.' });
  }

  const cleanKey = key.trim().toUpperCase();
  const cleanHWID = hwid.trim().toUpperCase();

  const record = database.keys[cleanKey];
  if (!record) {
    return res.status(404).json({ success: false, error: 'Chave de ativação inválida ou inexistente.' });
  }

  if (record.status === 'revoked') {
    return res.status(403).json({ success: false, error: 'Esta chave foi revogada pela administração.' });
  }

  // Verifica se já está vinculada a outro computador
  if (record.hwid && record.hwid !== cleanHWID) {
    return res.status(403).json({
      success: false,
      error: 'Esta chave já está vinculada e trancada em outro computador. Acesso negado.'
    });
  }

  // Primeiro uso: Tranca no HWID do cliente!
  const now = Date.now();
  if (!record.hwid) {
    record.hwid = cleanHWID;
    record.activatedAt = now;
    record.status = 'active';
    record.expiresAt = (record.days === -1 || record.days === 0) ? -1 : (now + record.days * 86400000);
    saveDatabase();
    console.log(`[LICENÇA] Chave ${cleanKey} ativada e trancada no HWID: ${cleanHWID}`);
  }

  // Verifica se já expirou
  if (record.expiresAt !== -1 && record.expiresAt < now) {
    record.status = 'expired';
    saveDatabase();
    return res.status(403).json({ success: false, error: 'Esta chave de ativação já expirou.' });
  }

  // Gera o token de segurança assinado
  const token = createLicenseToken(cleanKey, cleanHWID, record.expiresAt, record.plan);

  return res.json({
    success: true,
    token: token,
    key: cleanKey,
    hwid: cleanHWID,
    plan: record.plan,
    days: record.days,
    expiresAt: record.expiresAt
  });
});

// Endpoint de Verificação Periódica de Licença
app.post('/api/verify', (req, res) => {
  const { key, hwid, token } = req.body;

  if (!key || !hwid || !token) {
    return res.status(400).json({ success: false, error: 'Dados insuficientes.' });
  }

  const cleanKey = key.trim().toUpperCase();
  const cleanHWID = hwid.trim().toUpperCase();
  const record = database.keys[cleanKey];

  if (!record || record.status === 'revoked') {
    return res.status(403).json({ success: false, error: 'Licença inválida ou revogada.' });
  }

  if (record.hwid !== cleanHWID) {
    return res.status(403).json({ success: false, error: 'HWID divergente.' });
  }

  if (record.expiresAt !== -1 && record.expiresAt < Date.now()) {
    return res.status(403).json({ success: false, error: 'Licença expirada.' });
  }

  try {
    const isValid = verifyLicenseToken(cleanKey, cleanHWID, record.expiresAt, record.plan, token);
    if (!isValid) return res.status(403).json({ success: false, error: 'Assinatura inválida.' });
  } catch (e) {
    return res.status(403).json({ success: false, error: 'Falha na validação de token.' });
  }

  return res.json({ success: true, valid: true, expiresAt: record.expiresAt, plan: record.plan });
});

// ENDPOINTS DO WEB ADMIN DASHBOARD
app.get('/api/admin/keys', checkAdminSecret, (req, res) => {
  res.json({ success: true, keys: database.keys });
});

app.post('/api/admin/generate', checkAdminSecret, (req, res) => {
  const { days, plan, clientName } = req.body;
  const numDays = parseInt(days);
  const validDays = isNaN(numDays) || numDays <= 0 ? -1 : numDays;
  const newKey = generateRandomKey();
  
  database.keys[newKey] = {
    key: newKey,
    days: validDays,
    plan: plan || (validDays === -1 ? 'Vitalício VIP' : `${validDays} Dias Pro`),
    createdAt: Date.now(),
    activatedAt: null,
    expiresAt: null,
    hwid: null,
    buyerDiscordId: clientName || null,
    buyerTag: clientName || null,
    status: 'pending'
  };
  saveDatabase();
  console.log(`[ADMIN WEB] Nova chave gerada: ${newKey} (${database.keys[newKey].plan})`);
  res.json({ success: true, key: newKey });
});

app.post('/api/admin/revoke', checkAdminSecret, (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ success: false, error: 'Chave obrigatória.' });
  const cleanKey = key.trim().toUpperCase();
  if (!database.keys[cleanKey]) {
    return res.status(404).json({ success: false, error: 'Chave não encontrada.' });
  }
  database.keys[cleanKey].status = 'revoked';
  saveDatabase();
  console.log(`[ADMIN WEB] Chave revogada: ${cleanKey}`);
  res.json({ success: true, key: cleanKey });
});

app.post('/api/admin/delete', checkAdminSecret, (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ success: false, error: 'Chave obrigatória.' });
  const cleanKey = key.trim().toUpperCase();
  if (database.keys[cleanKey]) {
    delete database.keys[cleanKey];
    saveDatabase();
    console.log(`[ADMIN WEB] Chave excluída do banco: ${cleanKey}`);
  }
  res.json({ success: true });
});

app.get('/health', (req, res) => {
  const total = Object.keys(database.keys).length;
  const active = Object.values(database.keys).filter(k => k.status === 'active').length;
  res.json({ status: 'online', totalKeys: total, activeKeys: active, time: new Date() });
});

const apiPort = config.apiPort || 7777;
app.listen(apiPort, '0.0.0.0', () => {
  console.log(`[API LICENÇAS] Servidor ativo na porta ${apiPort}`);
  console.log(`[PAINEL ADMIN] Acesse o Painel Web em: http://localhost:${apiPort}/admin`);
});

// 4. DISCORD BOT CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User]
});

// Definição dos Slash Commands
const commands = [
  new SlashCommandBuilder()
    .setName('gerarkey')
    .setDescription('Gera uma nova chave de ativação para o Velvy Studio (Apenas Admin)')
    .addIntegerOption(opt =>
      opt.setName('dias')
        .setDescription('Validade da chave em dias (0 ou -1 para Vitalício)')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('plano')
        .setDescription('Nome do plano (Ex: Mensal Pro, Vitalício VIP)')
        .setRequired(false)
    )
    .addUserOption(opt =>
      opt.setName('cliente')
        .setDescription('Usuário do Discord que comprou a chave (opcional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('revogarkey')
    .setDescription('Revoga imediatamente o acesso de uma chave (Apenas Admin)')
    .addStringOption(opt =>
      opt.setName('chave')
        .setDescription('A chave VELVY-... a ser cancelada')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('consultarkey')
    .setDescription('Consulta status, HWID vinculado e validade de uma chave (Apenas Admin)')
    .addStringOption(opt =>
      opt.setName('chave')
        .setDescription('A chave VELVY-... a consultar')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('painel-vendas')
    .setDescription('Posta o painel de vendas personalizável via panel.json')
    .addChannelOption(opt =>
      opt.setName('canal')
        .setDescription('Canal onde o painel será enviado (opcional, padrão: canal atual)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('testar-boas-vindas')
    .setDescription('Simula o envio da notificação de boas-vindas no canal de novos membros (Apenas Admin)')
];

function isAdmin(interaction) {
  if (config.adminUserId && interaction.user.id === config.adminUserId) return true;
  if (config.adminRoleId && interaction.member && interaction.member.roles && interaction.member.roles.cache.has(config.adminRoleId)) return true;
  if (interaction.memberPermissions && interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return false;
}

// Construtor flexível de Embeds a partir de panel.json (suporta formato Discohook/Discord Webhook ou custom)
function buildEmbedsFromPanel(panelData) {
  if (!panelData) return null;
  const rawEmbeds = Array.isArray(panelData.embeds) && panelData.embeds.length > 0 
    ? panelData.embeds 
    : (panelData.embed ? [panelData.embed] : []);

  if (rawEmbeds.length === 0) return null;

  return rawEmbeds.map(emb => {
    const embed = new EmbedBuilder();
    if (emb.title) embed.setTitle(emb.title);
    if (emb.description) embed.setDescription(emb.description);
    
    // Cor
    if (emb.color !== undefined && emb.color !== null) {
      let col = emb.color;
      if (typeof col === 'string') col = parseInt(col.replace('#', ''), 16);
      if (!isNaN(col)) embed.setColor(col);
    } else {
      embed.setColor(0x9B43FF);
    }

    // Autor
    if (emb.author) {
      if (typeof emb.author === 'string') {
        embed.setAuthor({ name: emb.author });
      } else if (emb.author.name) {
        embed.setAuthor({ 
          name: emb.author.name, 
          iconURL: emb.author.icon_url || emb.author.iconURL || undefined,
          url: emb.author.url || undefined
        });
      }
    }

    // Thumbnail
    if (emb.thumbnail) {
      const url = typeof emb.thumbnail === 'string' ? emb.thumbnail : emb.thumbnail.url;
      if (url) embed.setThumbnail(url);
    }

    // Imagem
    if (emb.image) {
      const url = typeof emb.image === 'string' ? emb.image : emb.image.url;
      if (url) embed.setImage(url);
    }

    // Campos
    if (Array.isArray(emb.fields) && emb.fields.length > 0) {
      emb.fields.forEach(f => {
        if (f && f.name && f.value) {
          embed.addFields({ name: String(f.name), value: String(f.value), inline: !!f.inline });
        }
      });
    }

    // Rodapé
    if (emb.footer) {
      if (typeof emb.footer === 'string') {
        embed.setFooter({ text: emb.footer });
      } else if (emb.footer.text) {
        embed.setFooter({ 
          text: emb.footer.text, 
          iconURL: emb.footer.icon_url || emb.footer.iconURL || undefined 
        });
      }
    }

    return embed;
  });
}

// Envio automático da mensagem de boas-vindas para novos membros
async function sendWelcomeMessage(member) {
  try {
    const welcomeChannelId = config.welcomeChannelId || '1563925552199499918';
    const channel = member.guild.channels.cache.get(welcomeChannelId) || await member.guild.channels.fetch(welcomeChannelId).catch(() => null);
    if (!channel) {
      console.warn(`[BOAS-VINDAS] Canal de destino ${welcomeChannelId} não encontrado.`);
      return false;
    }

    const rulesId = config.welcomeRulesChannelId || '1563925554795647107';
    const plansId = config.welcomePlansChannelId || '1563925571405217959';
    const linksId = config.welcomeLinksChannelId || '1563925559610704024';
    const count = member.guild.memberCount || '?';

    const embed = new EmbedBuilder()
      .setColor(0x00D26A)
      .setTitle('🎉 Novo Membro Chegou à Velvy ZAP!')
      .setDescription(
        `Boas-vindas à nossa comunidade, <@${member.id}>! 👏\n\n` +
        `Agora você tem acesso ao ecossistema do **Velvy ZAP PRO** — CRM com IA Humanizada para WhatsApp.\n\n` +
        `**Primeiros passos essenciais:**\n` +
        `• Leia as regras em <#${rulesId}>\n` +
        `• Conheça nossos planos em <#${plansId}>\n` +
        `• Acesse o painel web em <#${linksId}>\n\n` +
        `*Você é o membro número #${count} do servidor!*`
      )
      .setThumbnail(member.user.displayAvatarURL({ extension: 'png', forceStatic: false, size: 256 }))
      .setFooter({ text: 'Velvy ZAP • Atendimento Inteligente & Escala' })
      .setTimestamp();

    await channel.send({
      content: `👏 Olá <@${member.id}>, seja muito bem-vindo(a)!`,
      embeds: [embed]
    });
    console.log(`[BOAS-VINDAS] Mensagem enviada para ${member.user.tag} em #${channel.name}`);
    return true;
  } catch (err) {
    console.error('[ERRO BOAS-VINDAS]:', err);
    return false;
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`[DISCORD BOT] Conectado com sucesso como: ${client.user.tag}`);

  // Registra slash commands no servidor
  if (config.clientId && config.guildId && config.token) {
    try {
      const rest = new REST({ version: '10' }).setToken(config.token);
      console.log('[DISCORD BOT] Atualizando slash commands no servidor...');
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: commands }
      );
      console.log('[DISCORD BOT] Slash commands registrados com sucesso!');
    } catch (e) {
      console.error('[ERRO] Falha ao registrar comandos:', e);
    }
  }
});

// Tratamento de Interações (Slash Commands e Botões)
client.on('interactionCreate', async (interaction) => {
  try {
    // 1. TRATAMENTO DE SLASH COMMANDS
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      // Comando /gerarkey
      if (commandName === 'gerarkey') {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: '❌ Você não tem permissão para gerar chaves.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const dias = interaction.options.getInteger('dias');
        const plano = interaction.options.getString('plano') || (dias <= 0 ? 'Vitalício VIP' : `${dias} Dias Pro`);
        const cliente = interaction.options.getUser('cliente');

        const newKey = generateRandomKey();
        database.keys[newKey] = {
          key: newKey,
          days: (dias <= 0 ? -1 : dias),
          plan: plano,
          createdAt: Date.now(),
          activatedAt: null,
          expiresAt: null,
          hwid: null,
          buyerDiscordId: cliente ? cliente.id : null,
          buyerTag: cliente ? cliente.tag : null,
          status: 'pending'
        };
        saveDatabase();

        const embed = new EmbedBuilder()
          .setColor(0x9B43FF)
          .setTitle('🔑 NOVA CHAVE VELVY STUDIO GERADA!')
          .setDescription(`Chave gerada com sucesso e pronta para ativação.\nEla será **trancada automaticamente no primeiro PC** em que o cliente colar.`)
          .addFields(
            { name: '✦ Chave de Ativação', value: `\`\`\`${newKey}\`\`\``, inline: false },
            { name: '📦 Plano', value: `${plano}`, inline: true },
            { name: '⏳ Validade', value: dias <= 0 ? 'Vitalício (Sem Expiração)' : `${dias} Dias`, inline: true },
            { name: '👤 Cliente', value: cliente ? `<@${cliente.id}>` : 'Não especificado', inline: true },
            { name: '🔒 Status HWID', value: '🟢 Pendente (Trancará no 1º PC ativado)', inline: false }
          )
          .setFooter({ text: 'Velvy Studio • Sistema de Licenciamento Seguro' })
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // Comando /revogarkey
      if (commandName === 'revogarkey') {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const chave = interaction.options.getString('chave').trim().toUpperCase();
        if (!database.keys[chave]) {
          return interaction.editReply({ content: `❌ Chave \`${chave}\` não encontrada no banco de dados.` });
        }

        database.keys[chave].status = 'revoked';
        saveDatabase();

        return interaction.editReply({ content: `🛑 A chave \`${chave}\` foi **REVOGADA** com sucesso. O app não funcionará mais com ela.` });
      }

      // Comando /consultarkey
      if (commandName === 'consultarkey') {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: '❌ Você não tem permissão.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const chave = interaction.options.getString('chave').trim().toUpperCase();
        const record = database.keys[chave];

        if (!record) {
          return interaction.editReply({ content: `❌ Chave \`${chave}\` não localizada.` });
        }

        const statusLabel = record.status === 'active' ? '🟢 Ativa' : record.status === 'revoked' ? '🔴 Revogada' : record.status === 'expired' ? '⚠️ Expirada' : '🟡 Pendente (Sem uso)';
        const expStr = record.expiresAt === -1 ? 'Vitalício' : record.expiresAt ? new Date(record.expiresAt).toLocaleString('pt-BR') : 'Ainda não ativada';

        const embed = new EmbedBuilder()
          .setColor(0x7C3AED)
          .setTitle(`🔍 Detalhes da Chave: ${chave}`)
          .addFields(
            { name: 'Status', value: statusLabel, inline: true },
            { name: 'Plano', value: record.plan || 'Padrão', inline: true },
            { name: 'HWID Vinculado', value: record.hwid ? `\`${record.hwid}\`` : 'Nenhum (Livre para 1º PC)', inline: false },
            { name: 'Expiração', value: expStr, inline: true },
            { name: 'Comprador', value: record.buyerDiscordId ? `<@${record.buyerDiscordId}>` : 'Não registrado', inline: true }
          )
          .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
      }

      // Comando /painel-vendas
      if (commandName === 'painel-vendas') {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: '❌ Apenas administradores podem postar o painel.', flags: MessageFlags.Ephemeral });
        }

        // Defer imediato para evitar timeout de 3 segundos do Discord
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const panelData = loadPanelConfig();
        const targetChannel = interaction.options.getChannel('canal') || interaction.channel;

        const embeds = buildEmbedsFromPanel(panelData) || [
          new EmbedBuilder()
            .setColor(0x9B43FF)
            .setTitle('⚡ VELVY STUDIO — ESTÚDIO PROFISSIONAL DE IA')
            .setDescription('Automatize a criação de vídeos, Face Swap, trocas de roupa e carrosséis com Trava Zero Créditos.')
            .setFooter({ text: 'Velvy Studio • Automação Inteligente' })
        ];

        const styleMap = {
          'Success': ButtonStyle.Success,
          'Primary': ButtonStyle.Primary,
          'Secondary': ButtonStyle.Secondary,
          'Danger': ButtonStyle.Danger,
          'Link': ButtonStyle.Link
        };

        const row = new ActionRowBuilder();
        if (panelData && Array.isArray(panelData.buttons) && panelData.buttons.length > 0) {
          panelData.buttons.forEach(btn => {
            const b = new ButtonBuilder()
              .setCustomId(btn.id || 'btn_abrir_ticket_compra')
              .setLabel(btn.label || 'Comprar Licença')
              .setStyle(styleMap[btn.style] || ButtonStyle.Success);
            if (btn.emoji) b.setEmoji(btn.emoji);
            row.addComponents(b);
          });
        } else {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId('btn_abrir_ticket_compra')
              .setLabel('🛒 Comprar Licença')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId('btn_duvidas_suporte')
              .setLabel('❓ Dúvidas & Suporte')
              .setStyle(ButtonStyle.Secondary)
          );
        }

        const msgPayload = { embeds: embeds, components: [row] };
        if (panelData && panelData.content) {
          msgPayload.content = panelData.content;
        }

        await targetChannel.send(msgPayload);
        return interaction.editReply({ content: `✅ Painel de vendas postado com sucesso em <#${targetChannel.id}>!` });
      }

      // Comando /testar-boas-vindas
      if (commandName === 'testar-boas-vindas') {
        if (!isAdmin(interaction)) {
          return interaction.reply({ content: '❌ Apenas administradores podem testar.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const ok = await sendWelcomeMessage(interaction.member);
        if (ok) {
          return interaction.editReply({ content: `✅ Mensagem de boas-vindas enviada com sucesso no canal <#${config.welcomeChannelId || '1563925552199499918'}>!` });
        } else {
          return interaction.editReply({ content: `❌ Falha ao enviar mensagem de boas-vindas. Verifique se o bot tem permissão no canal.` });
        }
      }
    }

    // 2. TRATAMENTO DE CLIQUES EM BOTÕES
    if (interaction.isButton()) {
      const { customId, user, guild } = interaction;

      // Botão de Comprar Licença -> Abre Ticket
      if (customId === 'btn_abrir_ticket_compra') {
        // Defer imediato para garantir que a criação de canais no Discord não estoure os 3s
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const existingTicket = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);
        if (existingTicket) {
          return interaction.editReply({
            content: `⚠️ Você já possui um atendimento aberto em <#${existingTicket.id}>!`
          });
        }

        const permissionOverwrites = [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel]
          },
          {
            id: user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.ReadMessageHistory
            ]
          },
          {
            id: client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels
            ]
          }
        ];

        if (config.adminUserId) {
          permissionOverwrites.push({
            id: config.adminUserId,
            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels]
          });
        }
        if (config.adminRoleId) {
          permissionOverwrites.push({
            id: config.adminRoleId,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.ManageChannels
            ]
          });
        }

        // Localiza a categoria ou canal pai configurado em config.json
        let parentCategoryId = null;
        const targetParentId = config.ticketCategoryId || config.ticketChannelId;
        if (targetParentId) {
          try {
            const ch = guild.channels.cache.get(targetParentId) || await guild.channels.fetch(targetParentId).catch(() => null);
            if (ch) {
              if (ch.type === ChannelType.GuildCategory) {
                parentCategoryId = ch.id;
              } else if (ch.parentId) {
                parentCategoryId = ch.parentId;
              } else {
                parentCategoryId = ch.id;
              }
            } else {
              parentCategoryId = targetParentId;
            }
          } catch (e) {
            console.warn('[TICKET] Aviso ao buscar categoria configurada:', e.message);
          }
        }

        let ticketChannel;
        try {
          ticketChannel = await guild.channels.create({
            name: `ticket-${user.username.toLowerCase()}`,
            type: ChannelType.GuildText,
            parent: parentCategoryId || null,
            permissionOverwrites: permissionOverwrites
          });
        } catch (errCreate) {
          console.warn('[TICKET] Falha com categoria específica, criando na raiz do servidor:', errCreate.message);
          ticketChannel = await guild.channels.create({
            name: `ticket-${user.username.toLowerCase()}`,
            type: ChannelType.GuildText,
            permissionOverwrites: permissionOverwrites
          });
        }

        database.tickets[ticketChannel.id] = {
          userId: user.id,
          username: user.username,
          createdAt: Date.now()
        };
        saveDatabase();

        const panelData = loadPanelConfig();
        const ticketEmbed = new EmbedBuilder();

        if (panelData && panelData.ticketWelcome) {
          const tw = panelData.ticketWelcome;
          const formatText = (str) => (str || '')
            .replace(/{username}/g, user.username)
            .replace(/{mention}/g, `<@${user.id}>`)
            .replace(/{staff}/g, config.adminRoleId ? `<@&${config.adminRoleId}>` : (config.adminUserId ? `<@${config.adminUserId}>` : 'Staff'));

          ticketEmbed.setTitle(formatText(tw.title || `✦ ATENDIMENTO VELVY STUDIO — ${user.username}`));
          ticketEmbed.setDescription(formatText(tw.description || `Olá <@${user.id}>! Seu atendimento foi iniciado com sucesso.`));
          if (tw.color) {
            let col = tw.color;
            if (typeof col === 'string') col = parseInt(col.replace('#', ''), 16);
            ticketEmbed.setColor(col || 0x9B43FF);
          } else {
            ticketEmbed.setColor(0x9B43FF);
          }
          if (tw.footer) ticketEmbed.setFooter({ text: formatText(tw.footer) });
        } else {
          ticketEmbed
            .setColor(0x9B43FF)
            .setTitle(`✦ ATENDIMENTO VELVY STUDIO — ${user.username}`)
            .setDescription(`Olá <@${user.id}>! Seu atendimento foi iniciado com sucesso.\n\n` +
              `**💳 Acesso Velvy Jutsu Pro:** R$ 69,90\n\n` +
              `**Chave PIX / Instruções de Pagamento:**\n` +
              `\`\`\`contato.velvyzap@gmail.com\`\`\`\n\n` +
              `Após realizar a transferência, envie o comprovante neste chat.\n` +
              `A equipe de atendimento validará o pagamento e enviará a sua **Chave de Ativação** aqui mesmo!\n` +
              `*(Você não precisa enviar nenhum código do seu PC: basta colar a chave no app e ela funcionará perfeitamente)*`
            )
            .setFooter({ text: 'Clique em "Fechar Ticket" ao encerrar a compra.' });
        }

        const ticketRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('btn_fechar_ticket_confirm')
            .setLabel('🔒 Fechar Ticket')
            .setStyle(ButtonStyle.Danger)
        );

        const staffMention = config.adminRoleId ? `<@&${config.adminRoleId}>` : (config.adminUserId ? `<@${config.adminUserId}>` : '');
        const pingHeader = staffMention ? `${staffMention} <@${user.id}>` : `<@${user.id}>`;

        await ticketChannel.send({
          content: `${pingHeader} Seja bem-vindo ao atendimento!`,
          embeds: [ticketEmbed],
          components: [ticketRow]
        });

        return interaction.editReply({
          content: `✅ Seu ticket foi aberto com sucesso: <#${ticketChannel.id}>`
        });
      }

      // Botão de Dúvidas
      if (customId === 'btn_duvidas_suporte') {
        return interaction.reply({
          content: `ℹ️ Para suporte ou dúvidas técnicas sobre os modelos e automações, abra um ticket em **Comprar Licença** ou contate a administração.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // Botão de Fechar Ticket
      if (customId === 'btn_fechar_ticket_confirm') {
        const isOwner = database.tickets[interaction.channel.id]?.userId === user.id;
        if (!isOwner && !isAdmin(interaction)) {
          return interaction.reply({ content: '❌ Apenas o criador do ticket ou admin podem fechar este canal.', flags: MessageFlags.Ephemeral });
        }

        await interaction.reply({ content: '🔒 Este ticket será fechado e excluído em 5 segundos...' });
        setTimeout(async () => {
          try {
            delete database.tickets[interaction.channel.id];
            saveDatabase();
            await interaction.channel.delete();
          } catch (e) {
            console.error('Erro ao deletar ticket:', e);
          }
        }, 5000);
      }
    }
  } catch (err) {
    console.error('[ERRO DISCORD INTERACTION]:', err);
    try {
      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ content: '❌ Ocorreu um erro ao processar sua solicitação.' });
      } else if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Ocorreu um erro ao processar sua solicitação.', flags: MessageFlags.Ephemeral });
      }
    } catch (e) {}
  }
});

// Evento de Entrada de Novos Membros no Servidor
client.on(Events.GuildMemberAdd, async (member) => {
  await sendWelcomeMessage(member);
});

// Inicialização do Bot
if (config.token && config.token !== 'COLOQUE_SEU_TOKEN_DO_BOT_AQUI') {
  client.login(config.token).catch(err => {
    if (err.message && err.message.includes('disallowed intents')) {
      console.error('\n' + '='.repeat(64));
      console.error('[ATENÇÃO: ATIVAÇÃO DE INTENTS NO DISCORD DEVELOPER PORTAL]');
      console.error('Para detectar a entrada de novos membros automaticamente:');
      console.error(`1. Acesse: https://discord.com/developers/applications/${config.clientId || '1573414633597829180'}/bot`);
      console.error('2. Desça a página até a seção "Privileged Gateway Intents"');
      console.error('3. Ative a caixinha: [x] SERVER MEMBERS INTENT');
      console.error('4. Clique no botão verde "Save Changes" no final da página.');
      console.error('='.repeat(64) + '\n');
    } else {
      console.error('[ERRO] Falha ao logar bot no Discord (Verifique o Token no config.json):', err.message);
    }
  });
} else {
  console.log('[AVISO] Bot não iniciado: Por favor configure seu Discord Token no arquivo config.json.');
}
