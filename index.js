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

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const GOOGLE_CREDS = process.env.GOOGLE_CREDS;
const BOT_OWNER_ID = process.env.BOT_OWNER_ID;
const CONFIG_PATH = path.join(__dirname, "guildConfig.json");

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ================= GOOGLE =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

// ================= CONFIG HELPERS =================
function loadAllConfigs() {
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, "{}");
  return JSON.parse(fs.readFileSync(CONFIG_PATH));
}

function getConfig(guildId) {
  return loadAllConfigs()[guildId];
}

function saveConfig(guildId, cfg) {
  const data = loadAllConfigs();
  data[guildId] = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

// ================= HELPERS =================
function isInTicketCategory(channel, cfg) {
  return channel.parentId === cfg.ticketCategoryId;
}

// ================= VOTE STORAGE =================
const voteMap = new Map();

// ================= READY =================
client.once(Events.ClientReady, async () => {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Setup migration bot for this server")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(o => o.setName("vote_channel").setDescription("Voting channel").setRequired(true))
      .addChannelOption(o => o.setName("welcome_channel").setDescription("Welcome channel").setRequired(true))
      .addRoleOption(o => o.setName("approve_role").setDescription("Migration officer role").setRequired(true))
      .addChannelOption(o => o.setName("approved_category").setDescription("Approved tickets category").setRequired(true))
      .addChannelOption(o => o.setName("rejected_category").setDescription("Rejected tickets category").setRequired(true))
      .addChannelOption(o => o.setName("ticket_category").setDescription("Ticket category").setRequired(true))
      .addStringOption(o => o.setName("sheet_id").setDescription("Google Sheet ID").setRequired(true)),

    new SlashCommandBuilder().setName("continue").setDescription("Extend bot usage for 30 days"),
    new SlashCommandBuilder().setName("fill-details").setDescription("Fill migration details"),
    new SlashCommandBuilder().setName("approve").setDescription("Approve this ticket"),
    new SlashCommandBuilder().setName("reject").setDescription("Reject this ticket")
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Migration SaaS Bot is online");
});

// ================= EXPIRY WARNING SYSTEM =================
setInterval(async () => {
  const configs = loadAllConfigs();
  const now = Date.now();

  for (const guildId in configs) {
    const cfg = configs[guildId];
    if (!cfg || cfg.warningSent) continue;

    const daysLeft = Math.ceil((cfg.expiresAt - now) / (24 * 60 * 60 * 1000));

    if (daysLeft <= 5 && daysLeft > 0) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;

      guild.channels.cache.forEach(channel => {
        if (channel.isTextBased() && channel.permissionsFor(guild.members.me).has("SendMessages")) {
          channel.send(
            "⚠️ **Migration Bot Notice** ⚠️\n\n" +
            "In **5 days**, this bot will stop working in this server.\n" +
            "Please contact the bot owner to continue using the service."
          ).catch(() => {});
        }
      });

      cfg.warningSent = true;
      saveConfig(guildId, cfg);
    }
  }
}, 60 * 60 * 1000); // check every hour

// ================= WELCOME =================
client.on(Events.GuildMemberAdd, async (member) => {
  const cfg = getConfig(member.guild.id);
  if (!cfg || Date.now() > cfg.expiresAt) return;

  const channel = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
  if (!channel) return;

  channel.send(`👑 **Welcome to our Migration Discord** 👑\n\nHello ${member}`);
});

// ================= INTERACTIONS =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ----- SETUP -----
  if (interaction.commandName === "setup") {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({ content: "❌ Only the bot owner can run setup.", ephemeral: true });
    }

    const cfg = {
      voteChannelId: interaction.options.getChannel("vote_channel").id,
      welcomeChannelId: interaction.options.getChannel("welcome_channel").id,
      approveRoleId: interaction.options.getRole("approve_role").id,
      approvedCategoryId: interaction.options.getChannel("approved_category").id,
      rejectedCategoryId: interaction.options.getChannel("rejected_category").id,
      ticketCategoryId: interaction.options.getChannel("ticket_category").id,
      sheetId: interaction.options.getString("sheet_id"),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      warningSent: false
    };

    saveConfig(interaction.guild.id, cfg);

    return interaction.reply({
      content:
        "✅ **Bot setup completed.Your subscription for next 30days is active now**\n\n" +
        "📄 Share your sheet with:\n" +
        "`migration-manager@migration-manager-483107.iam.gserviceaccount.com` (Editor)",
      ephemeral: true
    });
  }

  const cfg = getConfig(interaction.guild.id);
  if (!cfg) return interaction.reply({ content: "❌ Bot not set up yet.", ephemeral: true });

  // ----- CONTINUE -----
  if (interaction.commandName === "continue") {
    if (interaction.user.id !== BOT_OWNER_ID) {
      return interaction.reply({ content: "❌ Only the bot owner can use this command.", ephemeral: true });
    }

    cfg.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    cfg.warningSent = false;
    saveConfig(interaction.guild.id, cfg);

    return interaction.reply({ content: "✅ Bot access extended for 30 more days.", ephemeral: true });
  }

  // ----- EXPIRY CHECK -----
  if (Date.now() > cfg.expiresAt) {
    return interaction.reply({
      content:
        "⏳ **Bot access expired for this server.**\n" +
        "Please contact the bot owner to continue using the service.",
      ephemeral: true
    });
  }

  const channel = interaction.channel;

  // ----- TICKET ONLY -----
  const ticketOnlyCommands = ["fill-details", "approve", "reject"];
  if (ticketOnlyCommands.includes(interaction.commandName) && !isInTicketCategory(channel, cfg)) {
    return interaction.reply({
      content: "❌ This command can only be used inside a ticket channel.",
      ephemeral: true
    });
  }

  interaction.reply({ content: "⚠️ Feature logic unchanged from previous version.", ephemeral: true });
});

client.login(BOT_TOKEN);
