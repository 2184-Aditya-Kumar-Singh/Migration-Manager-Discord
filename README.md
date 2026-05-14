# Migration Manager Discord Bot

A powerful Discord automation bot built for managing kingdom/community migrations with ticket systems, voting workflows, officer approvals, and automated Google Sheets tracking.

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Discord.js](https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Google Sheets](https://img.shields.io/badge/Google%20Sheets-34A853?style=for-the-badge&logo=googlesheets&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Status](https://img.shields.io/badge/Status-Active-success?style=for-the-badge)

---

# Overview

Migration Manager is a custom Discord bot designed to automate and simplify community migration management inside Discord servers.

The bot handles:
- Ticket-based migration applications
- Community voting systems
- Officer approvals/rejections
- Automated Google Sheets logging
- Welcome and auto-sorting systems

Built using JavaScript and Discord.js, the project demonstrates backend automation, event-driven architecture, API integration, and scalable Discord bot development.

---

# Features

## Migration Workflow Automation
- Ticket-based migration requests
- Structured application handling
- Automated applicant management

## Community Voting System
- Public/community voting
- Vote tracking and management
- Transparent approval process

## Officer Approval System
- Officer review workflows
- Accept/reject functionality
- Moderation utilities

## Google Sheets Integration
- Automatic data logging
- Migration record management
- Real-time sheet updates

## Server Automation
- Welcome messages
- Auto sorting systems
- Role handling utilities

---

# Tech Stack

## Backend
- JavaScript
- Node.js

## Libraries & APIs
- Discord.js
- Google Sheets API

## Tools
- Git
- GitHub
- VS Code

---

# Architecture

```bash
Migration-Manager-Discord/
│
├── commands/
├── events/
├── handlers/
├── utils/
├── config/
├── sheets/
├── index.js
├── package.json
└── README.md
```

---

# Installation

## Prerequisites

Make sure you have:

- Node.js installed
- A Discord Bot Token
- Google Cloud credentials for Sheets API

---

# Clone Repository

```bash
git clone https://github.com/2184-Aditya-Kumar-Singh/Migration-Manager-Discord.git
```

```bash
cd Migration-Manager-Discord
```

---

# Install Dependencies

```bash
npm install
```

---

# Environment Variables

Create a `.env` file:

```env
DISCORD_TOKEN=your_discord_bot_token
GOOGLE_SHEETS_ID=your_sheet_id
GOOGLE_CLIENT_EMAIL=your_client_email
GOOGLE_PRIVATE_KEY=your_private_key
```

---

# Run The Bot

```bash
node index.js
```

Or using nodemon:

```bash
npm run dev
```

---

# Bot Capabilities

- Ticket management
- Community moderation
- Workflow automation
- Google Sheets synchronization
- Role management
- Approval pipelines

---

# Screenshots

## Bot Profile

Add your screenshots inside an `/assets` folder.

```md
![Migration Manager](assets/bot-preview.png)
```

---

# Real Use Case

This bot was developed for managing large Discord-based community/kingdom migration workflows where applications, approvals, and records needed to be automated efficiently.

It reduces manual moderation workload and improves migration coordination inside Discord communities.

---

# Future Improvements

- Slash command support
- Web dashboard
- Database integration (MongoDB/PostgreSQL)
- Analytics system
- Multi-server synchronization
- AI moderation utilities
- Docker deployment

---

# Learning Outcomes

This project helped in understanding:

- Discord bot architecture
- Event-driven programming
- API integrations
- Workflow automation systems
- Google Sheets API handling
- Real-time moderation systems
- Backend scalability concepts

---

# Author

## Aditya Kumar Singh

- B.Tech CSE @ KIIT University
- Java & JavaScript Developer
- Android & Backend Enthusiast
- Solved 300+ DSA Problems

GitHub:
https://github.com/2184-Aditya-Kumar-Singh

---

# Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to your branch
5. Open a Pull Request

---

# License

This project is licensed under the MIT License.

---

# Support

If you found this project useful, consider giving it a ⭐ on GitHub.
