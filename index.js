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

const CONFIG_PATH = path.join(__dirname, "guildConfig.json");

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ================= ENV =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const GOOGLE_CREDS = process.env.GOOGLE_CREDS;

// ================= GOOGLE =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

// ================= CONFIG HELPERS =================
function getConfig(guildId) {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const data = JSON.parse(raw);
  return data[guildId];
}

function saveConfig(guildId, cfg) {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  const data = JSON.parse(raw);
  data[guildId] = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

// ================= READY =================
client.once(Events.ClientReady, async () => {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup")
      .setDescription("Setup migration bot for this server")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption(o => o.setName("vote_channel").setDescription("Voting channel").setRequired(true))
      .addChannelOption(o => o.setName("welcome_channel").setDescription("Welcome channel").setRequired(true))
      .addRoleOption(o => o.setName("approve_role").setDescription("Approve/Reject role").setRequired(true))
      .addChannelOption(o => o.setName("approved_category").setDescription("Approved category").setRequired(true))
      .addChannelOption(o => o.setName("rejected_category").setDescription("Rejected category").setRequired(true))
      .addStringOption(o => o.setName("sheet_id").setDescription("Google Sheet ID").setRequired(true)),

    new SlashCommandBuilder().setName("fill-details").setDescription("Fill migration details"),
    new SlashCommandBuilder().setName("approve").setDescription("Approve this ticket"),
    new SlashCommandBuilder()
      .setName("reject")
      .setDescription("Reject this ticket")
      .addStringOption(o => o.setName("reason").setDescription("Reason (optional)"))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Bot ready (multi-server SaaS)");
});

// ================= SETUP =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setup") {
    const cfg = {
      voteChannelId: interaction.options.getChannel("vote_channel").id,
      welcomeChannelId: interaction.options.getChannel("welcome_channel").id,
      approveRoleId: interaction.options.getRole("approve_role").id,
      approvedCategoryId: interaction.options.getChannel("approved_category").id,
      rejectedCategoryId: interaction.options.getChannel("rejected_category").id,
      sheetId: interaction.options.getString("sheet_id")
    };

    saveConfig(interaction.guild.id, cfg);
    return interaction.reply("✅ Migration bot configured for this server.");
  }
});

client.login(BOT_TOKEN);
