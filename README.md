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

## 5. Vercel + Supabase Serverless (partial migration)

This repo now includes serverless API routes that can run on Vercel while you keep migrating from Express.

### Added endpoints

- `GET /api/health`
- `POST /api/applications/submit`
- `GET /api/applications/mine?discordId=...`

### Added files

- `api/_lib/supabase.js`
- `api/_lib/http.js`
- `api/health.js`
- `api/applications/submit.js`
- `api/applications/mine.js`
- `supabase/schema.sql`
- `vercel.json`

### Supabase setup

1. Open Supabase SQL editor.
2. Run `supabase/schema.sql`.
3. Copy `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

### Vercel environment variables

Set these in Vercel project settings:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `STAFF_DISCORD_IDS`
- `MANAGER_DISCORD_IDS`

### Quick test with cURL

```bash
curl -X POST https://your-vercel-domain/api/applications/submit \
	-H "Content-Type: application/json" \
	-d '{
		"ign":"TheoNotBald",
		"discordUser":"TheoNotBald",
		"discordUid":"985247124910395452",
		"age":18,
		"timezone":"UTC",
		"preferredSide":"Pirates",
		"hasMicrophone":"Yes",
		"streamingInfo":"No",
		"aboutYourself":"I like roleplay.",
		"eventGoals":"Have fun and help story arcs.",
		"pastEventExperience":"Past SMP RP and events.",
		"characterDescription":"A navigator with a moral code.",
		"failureStory":"I once overcommitted and missed deadlines.",
		"scenarioPiratesCornerYou":"I negotiate and stall for my crew.",
		"scenarioStrandedSailors":"I share food and coordinate rescue."
	}'
```

### Important note

Current API routes are server-side and ready for Vercel, but full auth/session migration from Express to stateless auth is still pending. This is an incremental first step.
