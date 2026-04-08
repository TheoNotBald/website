# Starfall Civilisation Event Applications Website

Local web app with:

- Discord OAuth login
- Three portals: applicant, staff, manager
- Application form with 14 required questions
- Manager accept/deny actions
- Automatic Discord DM on accept/deny
- Persistent local storage (`data/store.json`)

## 1. Install

```bash
npm install
```

## 2. Configure

Copy `.env.example` to `.env` and fill in values.

Required for Discord login + DMs:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_CALLBACK_URL`
- `DISCORD_BOT_TOKEN`
- `STAFF_DISCORD_IDS`
- `MANAGER_DISCORD_IDS`

## 3. Run

```bash
npm start
```

Default bind:

- Host: `0.0.0.0`
- Port: `444`

## 4. Callback URL

Set Discord OAuth callback URL to:

```text
https://your-domain.com/auth/discord/callback
```
