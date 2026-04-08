<<<<<<< HEAD
# Starfall Civilisation Event Applications Website

Local web app with:

- Discord OAuth login
- Three portals: applicant, staff, manager
- Application form with 14 required questions
- Manager accept/deny actions
- Automatic Discord DM on accept/deny
- Persistent local storage (`data/store.json`) suitable for 400+ applications

## 1. Install

```bash
npm install
```

## 2. Configure

Copy `.env.example` to `.env` and fill in values.

Required for real Discord login + DMs:

- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_CALLBACK_URL`
- `DISCORD_BOT_TOKEN`
- `STAFF_DISCORD_IDS`
- `MANAGER_DISCORD_IDS`

Use `ALLOW_DEV_LOGIN=true` to test all roles without Discord setup.

## 3. Run on port 444

```bash
npm start
```

Default bind:

- Host: `0.0.0.0`
- Port: `444`

## 4. Public IP access checklist

- Allow inbound TCP 444 in Windows Firewall.
- Port-forward router public TCP 444 to this machine's local IP.
- Use your public callback URL in Discord OAuth settings (same as `DISCORD_CALLBACK_URL`).

Example callback URL:

```text
http://YOUR_PUBLIC_IP/auth/discord/callback
```
=======
# website
s
>>>>>>> a211e12ab1ab890f7e082afec97008402e1487ac
