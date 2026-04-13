# Overdrive

Overdrive is a real-time Discord-integrated street racing game with a React frontend and a Node.js backend. Players can join races from a Discord-generated link, choose a role as racer, bettor, or viewer, use abilities during the race, and track leaderboard progress.

## Features

- Discord slash-command integration for starting and stopping race sessions
- Real-time race updates using Socket.IO
- Racer, bettor, and viewer roles
- Ability shop with reusable ability charges
- Persistent leaderboard, balances, and ability inventory
- Local test mode when Discord is not configured
- Production-ready split deployment for backend and frontend

## Project Structure

```text
Overdrive-main/
├── backend/   # Discord bot, API, sockets, race logic, persistence
└── frontend/  # React + Vite frontend
```

## Tech Stack

- Frontend: React, TypeScript, Vite, Socket.IO Client
- Backend: Node.js, TypeScript, Express, Socket.IO, Discord.js
- Storage: JSON-backed local persistence

## Local Setup

### 1. Install dependencies

Backend:

```bash
cd backend
npm install
```

Frontend:

```bash
cd frontend
npm install
```

### 2. Configure backend environment

Create `backend/.env`:

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_client_id
WEB_URL=http://localhost:5175
PORT=3001
ENABLE_MEMBER_EVENTS=true
```

Optional:

```env
DISCORD_GUILD_ID=your_test_server_id
ENABLE_PREFIX_COMMANDS=true
```

Notes:

- `ENABLE_MEMBER_EVENTS=true` requires `Server Members Intent` enabled in the Discord Developer Portal.
- `ENABLE_PREFIX_COMMANDS=true` requires `Message Content Intent` enabled in the Discord Developer Portal.
- If you leave Discord values empty, the backend runs in local test mode.

### 3. Run the backend

```bash
cd backend
npm run build
npm start
```

### 4. Run the frontend

```bash
cd frontend
npm run dev
```

Frontend local URL:

```text
http://localhost:5175
```

Local test session example:

```text
http://localhost:5175/?session=test-session&user=test
```

## Discord Setup

In the Discord Developer Portal:

1. Create or open your application
2. Add a bot user
3. Copy the bot token into `DISCORD_TOKEN`
4. Copy the application ID into `DISCORD_CLIENT_ID`
5. Enable `Server Members Intent` if using welcome events
6. Enable `Message Content Intent` only if using prefix commands
7. Invite the bot to your server with the required permissions

Once the backend is running, use:

- `/race` to create a race session
- `/stop` to stop the looping session
- `/ping`, `/help`, `/leaderboard`, `/stats` for bot actions

## Deployment

### Backend on Render

Use these settings:

- Root Directory: `backend`
- Build Command: `npm install && npm run build`
- Start Command: `npm start`

Set environment variables in Render:

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
WEB_URL=https://overdrive-puce.vercel.app/
ENABLE_MEMBER_EVENTS=true
```

Optional:

```env
DISCORD_GUILD_ID=your_test_server_id
ENABLE_PREFIX_COMMANDS=true
```

Do not hardcode the deployment port. Render provides `PORT` automatically.

### Frontend on Vercel

Use these settings:

- Root Directory: `frontend`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

Set environment variable in Vercel:

```env
VITE_API_URL=https://overdrive-8lvv.onrender.com
```

After frontend deployment, update backend `WEB_URL` in Render to the final Vercel URL and redeploy the backend.

## Validation Checklist

Before deployment, confirm:

- `backend/.env` is ignored and not committed
- frontend builds successfully
- backend builds successfully
- Discord slash commands register successfully
- backend and frontend deployed URLs point to each other correctly

## Useful Commands

Backend:

```bash
npm run build
npm start
npm run dev
```

Frontend:

```bash
npm run dev
npm run build
npm run lint
```

## Notes

- Slash commands scoped with `DISCORD_GUILD_ID` update much faster than global commands.
- If Discord says the application is not responding, check that the backend is actually running and that the bot token/intents are configured correctly.
- The project currently stores data in local JSON files under `backend/`.
