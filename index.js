const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
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
  .setDescription("Press Enter to open the welcome message editor"),
    new SlashCommandBuilder().setName("status").setDescription("Check migration service status for this server"),
    new SlashCommandBuilder().setName("fill-details").setDescription("Fill migration details"),
    new SlashCommandBuilder().setName("approve").setDescription("Approve this ticket"),
    new SlashCommandBuilder()
      .setName("reject")
      .setDescription("Reject this ticket")
      .addStringOption(o => o.setName("reason").setDescription("Reason")),

    new SlashCommandBuilder()
  .setName("continue")
  .setDescription("Extend bot service for this server (Owner only)")
  .addIntegerOption(o =>
    o.setName("days")
     .setDescription("Number of days to extend the service")
     .setRequired(true)
  )
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

    // 2-day warning
if (
  remaining <= 2 * 24 * 60 * 60 * 1000 &&
  remaining > 0 &&
  !cfg.warned &&
  !cfg.disabled
) {
  cfg.warned = true;
  saveConfig(guildId, cfg);

  const roleMention = `<@&${cfg.approveRoleId}>`;

  const warningMessage =
    "⚠️ **Migration Manager Service Notice**\n\n" +
    "⏳ This server’s migration service will **stop in 2 days**.\n\n" +
    "📌 Please contact the bot owner or renew the service to avoid interruption.\n\n" +
    `${roleMention}`;

  // Voting channel
  const voteChannel = guild.channels.cache.get(cfg.voteChannelId);
  if (voteChannel?.isTextBased()) {
    voteChannel.send(warningMessage).catch(() => {});
  }

  // Welcome channel
  const welcomeChannel = guild.channels.cache.get(cfg.welcomeChannelId);
  if (welcomeChannel?.isTextBased()) {
    welcomeChannel.send(warningMessage).catch(() => {});
  }
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

/* ================= TICKET CREATED MESSAGE ================= */
client.on(Events.ChannelCreate, async (channel) => {
  // Must be a guild text channel
  if (!channel.guild || !channel.parentId) return;

  const cfg = getConfig(channel.guild.id);
  if (!cfg || cfg.disabled) return;

  // Only trigger for ticket channels
  if (channel.parentId !== cfg.ticketCategoryId) return;
  setTimeout(async () =>{
  try {
    await channel.send(
`👋 **Welcome to your migration ticket**

Please begin by using the command:
**-> /fill-details**

📌 Ensure all details are accurate.
📸 Screenshots will be requested after submission.

⏳ A Migration Officer will review your application shortly.`
    );
  } catch (err) {
    console.error("Failed to send ticket welcome message:", err);
  }
  }, 2500);
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
    range: "Sheet1!A:J",
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[ticketId, "", "", "", "", "", "PENDING", "", "", user]]
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
    return interaction.reply({ content: "❌ Bot not active/setup yet.", ephemeral: true });
  }

  if (!interaction.member.roles.cache.has(cfg.approveRoleId)) {
    return interaction.reply({
      content: "❌ Only migration officers can set the welcome message.",
      ephemeral: true
    });
  }

  const modal = new ModalBuilder()
    .setCustomId("welcomeModal")
    .setTitle("Set Welcome Message");

  const messageInput = new TextInputBuilder()
    .setCustomId("welcomeMessage")
    .setLabel("Welcome message (use {user} for mention)")
    .setStyle(TextInputStyle.Paragraph) // ✅ MULTILINE
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(messageInput)
  );

  await interaction.showModal(modal);
}


/* STATUS */
if (interaction.commandName === "status") {
  const cfg = getConfig(interaction.guild.id);

  if (!cfg) {
    return interaction.reply({
      content: "❌ Migration Manager is not set up on this server.",
      ephemeral: false
    });
  }

  const now = Date.now();

  if (cfg.disabled || !cfg.expiry || cfg.expiry <= now) {
    return interaction.reply({
      content:
        "🔴 **Migration Manager Status**\n\n" +
        "❌ Service Status: **Expired**\n" +
        "📩 Contact the bot owner to renew service.",
      ephemeral: false
    });
  }

  const msLeft = cfg.expiry - now;
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));

  const badge =
    msLeft <= 7 * 24 * 60 * 60 * 1000
      ? "🆓 **Trial**"
      : "💎 **Paid**";

  return interaction.reply({
    content:
      "📊 **Migration Manager Status**\n\n" +
      `🏷️ Plan: ${badge}\n` +
      `⏳ Days Remaining: **${daysLeft} day(s)**\n` +
      "⚙️ Service is active and running.",
    ephemeral: false
  });
}

  
  /* SETUP */
  if (interaction.commandName === "setup") {
    if (interaction.user.id !== BOT_OWNER_ID)
      return interaction.reply({ content: "❌ Owner only.", ephemeral: false });

    const cfg = {
  voteChannelId: interaction.options.getChannel("vote_channel").id,
  welcomeChannelId: interaction.options.getChannel("welcome_channel").id,
  ticketCategoryId: interaction.options.getChannel("ticket_category").id,
  approvedCategoryId: interaction.options.getChannel("approved_category").id,
  rejectedCategoryId: interaction.options.getChannel("rejected_category").id,
  approveRoleId: interaction.options.getRole("approve_role").id,
  sheetId: interaction.options.getString("sheet_id"),
  expiry: Date.now() + 7 * 24 * 60 * 60 * 1000,
  warned: false,
  disabled: false
};


    saveConfig(interaction.guild.id, cfg);
   return interaction.reply({
  content:
`✅ **Migration bot configured successfully.**

📄 Make sure your Google Sheet is shared with:
\`migration-manager@migration-manager-483107.iam.gserviceaccount.com\` (Editor)`,
  ephemeral: false
});
  }

  /* CONTINUE */
  if (interaction.commandName === "continue") {
  if (interaction.user.id !== BOT_OWNER_ID) {
    return interaction.reply({ content: "❌ Owner only.", ephemeral: false });
  }

  const days = interaction.options.getInteger("days");

  if (days <= 0) {
    return interaction.reply({
      content: "❌ Days must be greater than 0.",
      ephemeral: true
    });
  }

  const cfg = getConfig(interaction.guild.id);

  const now = Date.now();
  const base = cfg.expiry && cfg.expiry > now ? cfg.expiry : now;

  cfg.expiry = base + days * 24 * 60 * 60 * 1000;
  cfg.warned = false;      // 🔥 VERY IMPORTANT
  cfg.disabled = false;

  saveConfig(interaction.guild.id, cfg);

  return interaction.reply({
    content: `✅ Service extended by **${days} days**.`,
    ephemeral: false
  });
}


  const cfg = getConfig(interaction.guild.id);
  if (!cfg || cfg.disabled)
    return interaction.reply({ content: "❌ Bot inactive.", ephemeral: false });

  const channel = interaction.channel;
  if (channel.parentId !== cfg.ticketCategoryId)
    return interaction.reply({ content: "❌ Ticket only command.", ephemeral: false });

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

  const channel = interaction.channel;
  const ticketId = channel.name;

  // ✅ IMMEDIATE reply (no defer = no spinner issues)
  await interaction.reply({
    content: "📝 Please answer the questions below.",
    ephemeral: true
  });

  // Optional: create vote safely
  await ensureVote();

  let row = await findRow(cfg.sheetId, ticketId);
  if (!row) {
    await createRow(cfg.sheetId, ticketId, interaction.user.username);
    row = await findRow(cfg.sheetId, ticketId);
  }

  const questions = [
    ["B", "📝 **Please enter your in-game name**\n(Exact name as shown in Rise of Kingdoms)"],
    ["C", "🆔 **Please enter your Governor ID**\n(You can find this in your ROK profile)"],
    ["D", "⚡ **What is your current power?**\n(You may include units like M / Million)"],
    ["E", "⚔️ **What are your total kill points?**\n(Enter the total shown in your profile)"],
    ["F", "👑 **What is your current VIP level?**"]
  ];

  let step = 0;

  // ✅ FIRST QUESTION — channel message
  await channel.send(questions[step][1]);

  const collector = channel.createMessageCollector({
    filter: m => m.author.id === interaction.user.id,
    time: 10 * 60 * 1000
  });

  collector.on("collect", async (msg) => {
    try {
      await updateCell(cfg.sheetId, row, questions[step][0], msg.content);
      step++;

      if (step < questions.length) {
        await channel.send(questions[step][1]);
      } else {
        collector.stop();
        await channel.send(
`✅ **Application details recorded**

📸 Please provide screenshots of:
• Commanders  
• Equipment  
• VIP Level  
• Resources & Speedups  
• ROK Profile (ID must be visible)

⏳ Our Migration Officers will review your information shortly.`
        );
      }
    } catch (err) {
      console.error("Fill-details error:", err);
      collector.stop();
      await channel.send("❌ An error occurred. Please contact staff.");
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

      await msg.edit(`🔒 **VOTING CLOSED — ${ticketId.toUpperCase()}**\n **Yes:** ${yes} | **No:** ${no}`);
      voteMap.delete(channel.id);
    }

    await updateCell(cfg.sheetId, row, "G", interaction.commandName === "approve" ? "APPROVED" : "REJECTED");
    await updateCell(cfg.sheetId, row, "H", interaction.user.username);
    await updateCell(cfg.sheetId, row, "I", new Date().toLocaleString());

   await channel.setParent(
  interaction.commandName === "approve"
    ? cfg.approvedCategoryId
    : cfg.rejectedCategoryId,
  { lockPermissions: false }
);

// keep ticket creator access
const creator = channel.permissionOverwrites.cache
  .filter(p => p.type === 1) // member overwrite
  .first();

if (creator) {
  await channel.permissionOverwrites.edit(creator.id, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true
  });
}

    interaction.reply({ content: "✅ Action completed.", ephemeral: true });
  }
});
/* ================= MODAL HANDLER ================= */
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit()) return;

  if (interaction.customId === "welcomeModal") {
    const cfg = getConfig(interaction.guild.id);
    if (!cfg || cfg.disabled) {
      return interaction.reply({
        content: "❌ Bot not active.",
        ephemeral: true
      });
    }

    const message = interaction.fields.getTextInputValue("welcomeMessage");

    cfg.welcomeMessage = message;
    saveConfig(interaction.guild.id, cfg);

    return interaction.reply({
      content: "✅ Welcome message updated successfully.",
      ephemeral: false
    });
  }
});

client.login(BOT_TOKEN);
