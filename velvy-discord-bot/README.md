# 🤖 VELVY DISCORD SALES BOT & LICENSE SERVER

Sistema integrado de Vendas, Abertura de Tickets e Emissão de Chaves de Licença com travamento automático de **HWID no primeiro uso**.

---

## ⚡ Como Configurar em 2 Minutos

1. Abra o arquivo `config.json` nesta pasta:
   - **`token`**: O Token do seu Bot no Discord Developer Portal.
   - **`clientId`**: O ID da Aplicação do Bot.
   - **`guildId`**: O ID do seu Servidor do Discord.
   - **`adminUserId`**: O seu ID de usuário do Discord (para que apenas você execute `/gerarkey`).
   - **`apiPort`**: Porta da API de validação (Padrão: `7777`).

2. No Discord Developer Portal (aba **Bot**):
   - Ative as opções de **Privileged Gateway Intents**:
     - ✅ **Server Members Intent**
     - ✅ **Message Content Intent**

3. Instale as dependências e inicie o bot:
   ```bash
   cd velvy-discord-bot
   npm install
   npm start
   ```

---

## 🛡️ Fluxo de Venda & Geração de Chaves

1. **Poste o Painel no seu canal de vendas:**
   Use o comando:
   ```
   /painel-vendas
   ```
   O bot postará a apresentação com o botão **🛒 Comprar Licença**.

2. **O Cliente clica em "Comprar Licença":**
   - O bot cria um canal privado `ticket-<nome-do-cliente>`.
   - Apenas você e o cliente têm acesso a essa sala.
   - O cliente recebe as instruções de pagamento.

3. **Após a confirmação do pagamento:**
   - Digite no chat (ou no próprio ticket):
     ```
     /gerarkey dias:30 plano:Mensal Pro cliente:@NomeDoCliente
     ```
   - O bot gera a chave limpa (Exemplo: `VELVY-A8F2-99B1-4C3D-E710`).
   - Copie e entregue a chave ao cliente.

4. **Ativação pelo Cliente no App:**
   - O cliente baixa o Velvy Studio e abre o app.
   - Na tela de ativação, cola a chave recebida e clica em **Ativar**.
   - O app contata a API do bot, vincula a chave ao HWID daquele computador no primeiro uso e libera o software.
   - Se o cliente tentar repassar a chave para outra pessoa, a ativação no segundo PC será **bloqueada automaticamente**.
