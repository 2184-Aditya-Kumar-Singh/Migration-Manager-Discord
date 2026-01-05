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

/* ================= BASIC ================= */
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
function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, "{}");
  return JSON.parse(fs.readFileSync(CONFIG_PATH));
}
function getConfig(guildId) {
  return readConfig()[guildId];
}
function saveConfig(guildId, cfg) {
  const data = readConfig();
  data[guildId] = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

/* ================= VOTE MAP ================= */
const voteMap = new Map(); // channelId -> messageId

/* ================= READY ================= */
client.once(Events.ClientReady, async () => {
  const commands = [
    new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Setup migration bot for this server")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

  .addChannelOption(o =>
    o.setName("vote_channel")
     .setDescription("Channel where voting messages will be posted")
     .setRequired(true)
  )

  .addChannelOption(o =>
    o.setName("welcome_channel")
     .setDescription("Channel where welcome messages will be sent")
     .setRequired(true)
  )

  .addChannelOption(o =>
    o.setName("ticket_category")
     .setDescription("Category where ticket channels are created")
     .setRequired(true)
  )

  .addChannelOption(o =>
    o.setName("approved_category")
     .setDescription("Category where approved tickets are moved")
     .setRequired(true)
  )

  .addChannelOption(o =>
    o.setName("rejected_category")
     .setDescription("Category where rejected tickets are moved")
     .setRequired(true)
  )

  .addRoleOption(o =>
    o.setName("approve_role")
     .setDescription("Role allowed to approve or reject tickets")
     .setRequired(true)
  )

  .addStringOption(o =>
    o.setName("sheet_id")
     .setDescription("Google Sheet ID (share with migration-manager@migration-manager-483107.iam.gserviceaccount.com)")
     .setRequired(true)
  ),
    
    new SlashCommandBuilder()
  .setName("welcome-setup")
  .setDescription("Set a custom welcome message for this server")
  .addStringOption(o =>
    o.setName("message")
     .setDescription("Welcome message (use {user} for mention)")
     .setRequired(true)
  ),

    new SlashCommandBuilder().setName("fill-details").setDescription("Fill migration details"),
    new SlashCommandBuilder().setName("approve").setDescription("Approve this ticket"),
    new SlashCommandBuilder()
      .setName("reject")
      .setDescription("Reject this ticket")
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder()
      .setName("continue")
      .setDescription("Extend bot service for this server (Owner only)")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Migration Manager fully online");
});

/* ================= SERVICE TIMER ================= */
setInterval(async () => {
  const data = readConfig();
  const now = Date.now();

  for (const [guildId, cfg] of Object.entries(data)) {
    if (!cfg.expiry) continue;

    const remaining = cfg.expiry - now;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    // 25 day warning
    if (remaining < 5 * 24 * 60 * 60 * 1000 && !cfg.warned) {
      cfg.warned = true;
      saveConfig(guildId, cfg);

      guild.channels.cache
        .filter(c => c.isTextBased())
        .forEach(c => {
          c.send(
            "⚠️ **Migration Manager Notice**\n\n" +
            "This bot will stop working in **5 days**.\n" +
            "Please contact the owner to continue using the service."
          ).catch(() => {});
        });
    }

    // Expired
    if (remaining <= 0) {
      cfg.disabled = true;
      saveConfig(guildId, cfg);
    }
  }
}, 60 * 60 * 1000);

/* ================= WELCOME ================= */
client.on(Events.GuildMemberAdd, async member => {
  const cfg = getConfig(member.guild.id);
  if (!cfg || cfg.disabled || !cfg.welcomeMessage) return;

  const ch = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
   if (!ch) return;

  const msg = cfg.welcomeMessage.replace("{user}", `<@${member.id}>`);
  ch.send(msg).catch(() => {});
});

/* ================= SHEET HELPERS ================= */
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
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  /* WELCOME SETUP */
if (interaction.commandName === "welcome-setup") {
  const cfg = getConfig(interaction.guild.id);
  if (!cfg || cfg.disabled) {
    return interaction.reply({ content: "❌ Bot not active.", ephemeral: true });
  }

  if (!interaction.member.roles.cache.has(cfg.approveRoleId)) {
    return interaction.reply({
      content: "❌ Only migration officers can set the welcome message.",
      ephemeral: true
    });
  }

  const message = interaction.options.getString("message");

  cfg.welcomeMessage = message;
  saveConfig(interaction.guild.id, cfg);

  return interaction.reply({
    content: "✅ Welcome message updated successfully.",
    ephemeral: true
  });
}

  
  /* SETUP */
  if (interaction.commandName === "setup") {
    if (interaction.user.id !== BOT_OWNER_ID)
      return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

    const cfg = {
  voteChannelId: interaction.options.getChannel("vote_channel").id,
  welcomeChannelId: interaction.options.getChannel("welcome_channel").id,
  ticketCategoryId: interaction.options.getChannel("ticket_category").id,
  approvedCategoryId: interaction.options.getChannel("approved_category").id,
  rejectedCategoryId: interaction.options.getChannel("rejected_category").id,
  approveRoleId: interaction.options.getRole("approve_role").id,
  sheetId: interaction.options.getString("sheet_id"),
  expiry: Date.now() + 30 * 24 * 60 * 60 * 1000,
  warned: false,
  disabled: false
};


    saveConfig(interaction.guild.id, cfg);
    return interaction.reply({ content: "✅ Setup completed.you have been subscribed for 30days", ephemeral: true });
  }

  /* CONTINUE */
  if (interaction.commandName === "continue") {
    if (interaction.user.id !== BOT_OWNER_ID)
      return interaction.reply({ content: "❌ Owner only.", ephemeral: true });

    const cfg = getConfig(interaction.guild.id);
    cfg.expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    cfg.warned = false;
    cfg.disabled = false;
    saveConfig(interaction.guild.id, cfg);

    return interaction.reply({ content: "✅ Service extended by 30 days.", ephemeral: true });
  }

  const cfg = getConfig(interaction.guild.id);
  if (!cfg || cfg.disabled)
    return interaction.reply({ content: "❌ Bot inactive.", ephemeral: true });

  const channel = interaction.channel;
  if (channel.parentId !== cfg.ticketCategoryId)
    return interaction.reply({ content: "❌ Ticket only command.", ephemeral: true });

  const ticketId = channel.name;

  /* ENSURE VOTE */
  async function ensureVote() {
    if (voteMap.has(channel.id)) return;
    const voteChannel = await interaction.guild.channels.fetch(cfg.voteChannelId);
    const msg = await voteChannel.send(`🗳️ **Vote for ${ticketId.toUpperCase()}**`);
    await msg.react("✅");
    await msg.react("❌");
    voteMap.set(channel.id, msg.id);
  }

  /* FILL DETAILS */
  if (interaction.commandName === "fill-details") {
    await ensureVote();

    let row = await findRow(cfg.sheetId, ticketId);
    if (!row) {
      await createRow(cfg.sheetId, ticketId, interaction.user.username);
      row = await findRow(cfg.sheetId, ticketId);
    }

    const qs = [
      ["B", "📝 **Please enter your in-game name**"],
      ["C", "⚡ **What is your current power?**"],
      ["D", "⚔️ **What are your total kill points?**"],
      ["E", "👑 **What is your VIP level?**"]
    ];

    let i = 0;
    await interaction.reply(qs[i][1]);

    const collector = channel.createMessageCollector({
      filter: m => m.author.id === interaction.user.id,
      time: 10 * 60 * 1000
    });

    collector.on("collect", async msg => {
      await updateCell(cfg.sheetId, row, qs[i][0], msg.content);
      i++;
      if (i < qs.length) channel.send(qs[i][1]);
      else {
        collector.stop();
        channel.send(
          "✅ **Details recorded. Please upload screenshots of your ROK profile, Bag, Commanders/ Equipments and wait for officers.**"
        );
      }
    });
  }

  /* APPROVE / REJECT */
  if (["approve", "reject"].includes(interaction.commandName)) {
    if (!interaction.member.roles.cache.has(cfg.approveRoleId))
      return interaction.reply({ content: "❌ No permission.", ephemeral: true });

    const row = await findRow(cfg.sheetId, ticketId);
    if (!row) return interaction.reply({ content: "❌ Ticket not found.", ephemeral: true });

    const msgId = voteMap.get(channel.id);
    if (msgId) {
      const voteChannel = await interaction.guild.channels.fetch(cfg.voteChannelId);
      const msg = await voteChannel.messages.fetch(msgId);

      const yes = msg.reactions.cache.get("✅")
        ? (await msg.reactions.cache.get("✅").users.fetch()).size - 1
        : 0;
      const no = msg.reactions.cache.get("❌")
        ? (await msg.reactions.cache.get("❌").users.fetch()).size - 1
        : 0;

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

client.login(BOT_TOKEN);
