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

// ================= BASIC =================
const BOT_TOKEN = process.env.BOT_TOKEN;
const GOOGLE_CREDS = process.env.GOOGLE_CREDS;
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

// ================= GOOGLE =================
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(GOOGLE_CREDS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});
const sheets = google.sheets({ version: "v4", auth });

// ================= CONFIG HELPERS =================
function getConfig(guildId) {
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, "{}");
  const data = JSON.parse(fs.readFileSync(CONFIG_PATH));
  return data[guildId];
}

function saveConfig(guildId, cfg) {
  const data = fs.existsSync(CONFIG_PATH)
    ? JSON.parse(fs.readFileSync(CONFIG_PATH))
    : {};
  data[guildId] = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

// ================= VOTE STORAGE =================
const voteMap = new Map(); // channelId -> voteMessageId

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
      .addStringOption(o =>
        o.setName("sheet_id")
         .setDescription("Google Sheet ID (Share with migration-manager@migration-manager-483107.iam.gserviceaccount.com)")
         .setRequired(true)
      ),

    new SlashCommandBuilder().setName("fill-details").setDescription("Fill migration details"),
    new SlashCommandBuilder().setName("approve").setDescription("Approve this ticket"),
    new SlashCommandBuilder()
      .setName("reject")
      .setDescription("Reject this ticket")
      .addStringOption(o => o.setName("reason").setDescription("Reason (optional)"))
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

  console.log("✅ Migration SaaS Bot is online");
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

    return interaction.reply(
      "✅ **Migration bot configured successfully.**\n\n" +
      "📄 Make sure your Google Sheet is shared with:\n" +
      "`migration-manager@migration-manager-483107.iam.gserviceaccount.com` (Editor)"
    );
  }
});

// ================= WELCOME =================
client.on(Events.GuildMemberAdd, async (member) => {
  const cfg = getConfig(member.guild.id);
  if (!cfg) return;

  const channel = await member.guild.channels.fetch(cfg.welcomeChannelId).catch(() => null);
  if (!channel) return;

  channel.send(
`👑 **Welcome to the Migration Discord** 👑

Hello ${member},
Please read all migration rules and information carefully.

🚀 We look forward to building a strong kingdom together.`
  );
});

// ================= TICKET CREATE =================
client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild || !channel.name.startsWith("ticket-")) return;

  const cfg = getConfig(channel.guild.id);
  if (!cfg) return;

  const voteChannel = await channel.guild.channels.fetch(cfg.voteChannelId).catch(() => null);
  if (!voteChannel) return;

  const msg = await voteChannel.send(`🗳️ **Vote for ${channel.name.toUpperCase()}**`);
  await msg.react("✅");
  await msg.react("❌");

  voteMap.set(channel.id, msg.id);
});

// ================= GOOGLE HELPERS =================
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

// ================= COMMANDS =================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cfg = getConfig(interaction.guild.id);
  if (!cfg) return interaction.reply({ content: "❌ Bot not setup yet.", ephemeral: true });

  const channel = interaction.channel;
  const ticketId = channel.name;
  const sheetId = cfg.sheetId;

  // ----- FILL DETAILS -----
  if (interaction.commandName === "fill-details") {
    let row = await findRow(sheetId, ticketId);
    if (!row) {
      await createRow(sheetId, ticketId, interaction.user.username);
      row = await findRow(sheetId, ticketId);
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
      await updateCell(sheetId, row, questions[step].col, msg.content);
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

  // ----- APPROVE / REJECT -----
  if (interaction.commandName === "approve" || interaction.commandName === "reject") {
    if (!interaction.member.roles.cache.has(cfg.approveRoleId)) {
      return interaction.reply({ content: "❌ No permission", ephemeral: true });
    }

    const row = await findRow(sheetId, ticketId);
    if (!row) return interaction.reply({ content: "❌ Ticket not found", ephemeral: true });

    const voteMsgId = voteMap.get(channel.id);
    if (voteMsgId) {
      const voteChannel = await channel.guild.channels.fetch(cfg.voteChannelId);
      const msg = await voteChannel.messages.fetch(voteMsgId);
      const yes = (msg.reactions.cache.get("✅")?.count || 1) - 1;
      const no = (msg.reactions.cache.get("❌")?.count || 1) - 1;
      await msg.edit(`🔒 **VOTING CLOSED — ${ticketId.toUpperCase()}**\n✅ Yes: ${yes} | ❌ No: ${no}`);
      voteMap.delete(channel.id);
    }

    const officer = interaction.user.username;
    await updateCell(sheetId, row, "F", interaction.commandName === "approve" ? "APPROVED" : "REJECTED");
    await updateCell(sheetId, row, "G", officer);
    await updateCell(sheetId, row, "H", new Date().toLocaleString());

    await channel.setParent(
      interaction.commandName === "approve"
        ? cfg.approvedCategoryId
        : cfg.rejectedCategoryId
    );

    interaction.reply({ content: "✅ Action completed.", ephemeral: true });
  }
});

client.login(BOT_TOKEN);
