const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

/* ================= ENV ================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const GOOGLE_CREDS = process.env.GOOGLE_CREDS;
const BOT_OWNER_ID = process.env.BOT_OWNER_ID;
const CONFIG_PATH = path.join(__dirname, "guildConfig.json");

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

/* ================= GOOGLE ================= */
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

/* ================= CONFIG HELPERS ================= */
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, "{}");
  return JSON.parse(fs.readFileSync(CONFIG_PATH));
}
function saveConfig(data) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}
function getGuildConfig(guildId) {
  return loadConfig()[guildId];
}

/* ================= HELPERS ================= */
function isInTicketCategory(channel, cfg) {
  return channel.parentId === cfg.ticketCategoryId;
}
function licenseValid(cfg) {
  return Date.now() < cfg.expiresAt;
}

/* ================= VOTE STORAGE ================= */
const voteMap = new Map();

/* ================= READY ================= */
client.once(Events.ClientReady, async () => {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Setup migration bot")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(o => o.setName("vote_channel").setRequired(true))
      .addChannelOption(o => o.setName("welcome_channel").setRequired(true))
      .addRoleOption(o => o.setName("approve_role").setRequired(true))
      .addChannelOption(o => o.setName("approved_category").setRequired(true))
      .addChannelOption(o => o.setName("rejected_category").setRequired(true))
      .addChannelOption(o => o.setName("ticket_category").setRequired(true))
      .addStringOption(o =>
        o.setName("sheet_id")
         .setDescription("Share with migration-manager@migration-manager-483107.iam.gserviceaccount.com")
         .setRequired(true)
      ),

    new SlashCommandBuilder().setName("continue").setDescription("Extend service"),
    new SlashCommandBuilder().setName("fill-details").setDescription("Fill migration details"),
    new SlashCommandBuilder().setName("approve").setDescription("Approve ticket"),
    new SlashCommandBuilder()
      .setName("reject")
      .setDescription("Reject ticket")
      .addStringOption(o => o.setName("reason").setDescription("Reason"))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Migration Manager Bot Online");
});

/* ================= WELCOME ================= */
client.on(Events.GuildMemberAdd, async (member) => {
  const cfg = getGuildConfig(member.guild.id);
  if (!cfg || !licenseValid(cfg)) return;

  const ch = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
  if (!ch) return;

  ch.send(`👑 **Welcome to our Migration Discord** 👑

Hello ${member}`);
});

/* ================= GOOGLE HELPERS ================= */
async function findRow(sheetId, ticketId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "Sheet1!A:A"
  });
  const rows = res.data.values || [];
  const idx = rows.findIndex(r => r[0] === ticketId);
  return idx === -1 ? null : idx + 1;
}

async function createRow(sheetId, ticketId, user) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Sheet1!A:I",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[ticketId, "", "", "", "", "PENDING", "", "", user]]
    }
  });
}

async function updateCell(sheetId, row, col, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Sheet1!${col}${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] }
  });
}

/* ================= INTERACTIONS ================= */
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const data = loadConfig();

  /* ----- SETUP ----- */
  if (interaction.commandName === "setup") {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({ content: "❌ Only the bot owner can run setup.", ephemeral: true });
    }

    data[interaction.guild.id] = {
      voteChannelId: interaction.options.getChannel("vote_channel").id,
      welcomeChannelId: interaction.options.getChannel("welcome_channel").id,
      approveRoleId: interaction.options.getRole("approve_role").id,
      approvedCategoryId: interaction.options.getChannel("approved_category").id,
      rejectedCategoryId: interaction.options.getChannel("rejected_category").id,
      ticketCategoryId: interaction.options.getChannel("ticket_category").id,
      sheetId: interaction.options.getString("sheet_id"),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      warned: false
    };

    saveConfig(data);

    return interaction.reply({
      content:
        "✅ **Bot setup completed.**\n\n" +
        "📄 Share your sheet with:\n" +
        "`migration-manager@migration-manager-483107.iam.gserviceaccount.com` (Editor)",
      ephemeral: true
    });
  }

  const cfg = data[interaction.guild.id];
  if (!cfg) return interaction.reply({ content: "❌ Bot not setup yet.", ephemeral: true });
  if (!licenseValid(cfg)) return interaction.reply({ content: "❌ Service expired.", ephemeral: true });

  /* ----- CONTINUE ----- */
  if (interaction.commandName === "continue") {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({ content: "❌ Only owner can extend.", ephemeral: true });
    }
    cfg.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    cfg.warned = false;
    saveConfig(data);
    return interaction.reply({ content: "✅ Service extended.", ephemeral: true });
  }

  const channel = interaction.channel;
  const ticketId = channel.name;

  const ticketOnly = ["fill-details", "approve", "reject"];
  if (ticketOnly.includes(interaction.commandName) && !isInTicketCategory(channel, cfg)) {
    return interaction.reply({ content: "❌ This command can only be used inside a ticket channel.", ephemeral: true });
  }

  /* ----- ENSURE VOTE ----- */
  async function ensureVote() {
    if (voteMap.has(channel.id)) return;
    const voteChannel = await interaction.guild.channels.fetch(cfg.voteChannelId).catch(() => null);
    if (!voteChannel) return;

    const msg = await voteChannel.send(`🗳️ **Vote for ${ticketId.toUpperCase()}**`);
    await msg.react("✅");
    await msg.react("❌");
    voteMap.set(channel.id, msg.id);
  }

  /* ----- FILL DETAILS ----- */
  if (interaction.commandName === "fill-details") {
    await ensureVote();

    let row = await findRow(cfg.sheetId, ticketId);
    if (!row) {
      await createRow(cfg.sheetId, ticketId, interaction.user.username);
      row = await findRow(cfg.sheetId, ticketId);
    }

    const questions = [
      { col: "B", q: "📝 **Please enter your in-game name**" },
      { col: "C", q: "⚡ **What is your current power?**" },
      { col: "D", q: "⚔️ **What are your total kill points?**" },
      { col: "E", q: "👑 **What is your VIP level?**" }
    ];

    let step = 0;
    await interaction.reply(questions[step].q);

    const collector = channel.createMessageCollector({
      filter: m => m.author.id === interaction.user.id,
      time: 10 * 60 * 1000
    });

    collector.on("collect", async (msg) => {
      await updateCell(cfg.sheetId, row, questions[step].col, msg.content);
      step++;

      if (step < questions.length) {
        channel.send(questions[step].q);
      } else {
        collector.stop();
        channel.send(
`✅ **Application details recorded**

📸 Please provide screenshots of:
• Commanders  
• Equipment  
• VIP Level  
• Resources & Speedups  
• ROK Profile (ID must be visible)

⏳ Our Migration Officers will review your submission and contact you.`
        );
      }
    });
  }

  /* ----- APPROVE / REJECT ----- */
  if (interaction.commandName === "approve" || interaction.commandName === "reject") {
    if (!interaction.member.roles.cache.has(cfg.approveRoleId)) {
      return interaction.reply({ content: "❌ No permission.", ephemeral: true });
    }

    const row = await findRow(cfg.sheetId, ticketId);
    if (!row) return interaction.reply({ content: "❌ Ticket not found.", ephemeral: true });

    const voteMsgId = voteMap.get(channel.id);
    if (voteMsgId) {
      const voteChannel = await interaction.guild.channels.fetch(cfg.voteChannelId);
      const msg = await voteChannel.messages.fetch(voteMsgId);
      const yes = (msg.reactions.cache.get("✅")?.count || 1) - 1;
      const no = (msg.reactions.cache.get("❌")?.count || 1) - 1;
      await msg.edit(`🔒 **VOTING CLOSED — ${ticketId.toUpperCase()}**\n✅ Yes: ${yes} | ❌ No: ${no}`);
      voteMap.delete(channel.id);
    }

    await updateCell(cfg.sheetId, row, "F", interaction.commandName === "approve" ? "APPROVED" : "REJECTED");
    await updateCell(cfg.sheetId, row, "G", interaction.user.username);
    await updateCell(cfg.sheetId, row, "H", new Date().toLocaleString());

    await channel.setParent(
      interaction.commandName === "approve"
        ? cfg.approvedCategoryId
        : cfg.rejectedCategoryId
    );

    interaction.reply({ content: "✅ Action completed.", ephemeral: true });
  }
});

/* ================= 25-DAY WARNING ================= */
setInterval(() => {
  const data = loadConfig();
  for (const guildId in data) {
    const cfg = data[guildId];
    if (!cfg || cfg.warned) continue;

    if (Date.now() > cfg.expiresAt - 5 * 24 * 60 * 60 * 1000) {
      client.guilds.fetch(guildId).then(guild => {
        guild.channels.cache
          .filter(c => c.isTextBased())
          .forEach(c =>
            c.send("⚠️ **Service will stop in 5 days. Contact owner to continue using Migration Manager.**")
              .catch(() => {})
          );
      }).catch(() => {});
      cfg.warned = true;
      saveConfig(data);
    }
  }
}, 6 * 60 * 60 * 1000);

client.login(BOT_TOKEN);
