# Vibegage

**One collab. Every chat. One clear vibe.** Vibegage is a live dashboard and OBS browser-source overlay for Twitch collabs. It turns fast moving chat into a per-channel pulse, catches repeat questions, and shows where chats agree or split.

## Judge quick start: offline demo

You need Node.js 20.6 or newer and npm. This demo needs no Twitch credentials or OpenAI key.

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). In a second PowerShell terminal, from the project folder, start four simulated chats:

```powershell
npm run sim -- --offline --channels=4 --rate=18
```

Let it run for 15 seconds for the first summary. The simulator posts realistic fake chat locally, including hype, questions, inside jokes, and disagreements themed around HAUNT, a spooky minesweeper game with ghosts and chalk. The dashboard refreshes every 15 seconds and summarizes a rolling three minute window. Click **Answered** to clear a caught question.

`--channels` accepts 2 to 4. `--rate` controls approximate messages per second. Stop the simulator and server with **Ctrl+C**.

If port 3000 is busy, set the same port in both PowerShell terminals and use it for the browser URL:

```powershell
$env:PORT = "3217"
npm run dev
```

In the second terminal:

```powershell
$env:PORT = "3217"
npm run sim -- --offline --channels=4 --rate=18
```

## OBS overlay

Open `http://localhost:3000/overlay.html` in a browser, or add it directly in OBS as a **Browser Source**:

- URL: `http://localhost:3000/overlay.html`
- Width: `1920`
- Height: `1080`
- Leave the page background transparent; the overlay is designed to sit over a game or camera scene.

The animated scoreboard calls out the loudest chat, the most hyped chat, the most confused chat, and the current agree-or-split read. It updates from the same WebSocket feed as the dashboard. For another server port, change `3000` in the URL to that port.

## Turn on OpenAI summaries (optional)

Add an API key to `.env`:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

Restart the server. With a key, Vibegage requests structured JSON summaries and semantically merges similar questions. Without a key, the offline summarizer still powers the dashboard and overlay using local heuristics.

## Connect Twitch chat

1. Create a Twitch application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps). Set its OAuth Redirect URL to `http://localhost:3000/auth/twitch/callback`.
2. Copy the Client ID and create a Client Secret. Put them in `.env`:

   ```dotenv
   TWITCH_CLIENT_ID=your_client_id
   TWITCH_CLIENT_SECRET=your_client_secret
   TWITCH_REDIRECT_URI=http://localhost:3000/auth/twitch/callback
   ```

3. Restart Vibegage. Each participating broadcaster opens the dashboard, signs in to their own Twitch account, and clicks **Authorize channel**. Twitch redirects back when that channel has granted access. Repeat for the other streamers.
4. Start or join a Twitch Shared Chat session. Vibegage listens for its participant changes and includes authorized participants in the live roster. Chat from channels that have not authorized the app is not read.

Every broadcaster must authorize independently because Twitch grants access to their own channel. Vibegage requests these scopes:

| Scope | Who authorizes it | Purpose |
| --- | --- | --- |
| `user:read:chat` | Each participating streamer | Allows that streamer’s user access token to read chat through `channel.chat.message`. |
| `user:bot` | Each participating streamer | Identifies the app’s chat reader as a bot account for Twitch’s chatbot authorization model. |
| `channel:bot` | Each participating streamer | Grants the app bot access for that broadcaster’s channel. |

Twitch’s `channel.chat.message` subscription requires `user:read:chat` from the chatting user. When subscriptions use an **app access token**, Twitch additionally requires `user:bot` from the chat reader and either `channel:bot` from the broadcaster or moderator status. This project uses each broadcaster’s **user access token** for its EventSub WebSocket session, and requests all three scopes so the channel authorization also covers Twitch’s bot installation model. The `channel.shared_chat.begin`, `update`, and `end` EventSub types themselves require no additional scope.

The callback URI in `.env` must exactly match the URI in the Twitch Developer Console. If you run on another port, update both places. Tokens stay in server memory, refresh while the server runs, and must be authorized again after a restart.

## Build and run the compiled app

```powershell
npm run build
npm start
```

Then open `http://localhost:3000`. The build compiles TypeScript and copies the dashboard and overlay assets into `dist`.

## Publish to Render

The project includes a [`render.yaml`](render.yaml) Blueprint. Render Web Services support this app’s Node server, HTTP/WebSocket traffic, and custom domains ([Web Services](https://render.com/docs/web-services), [WebSockets](https://render.com/docs/websocket), [custom domains](https://render.com/docs/custom-domains)).

1. Push this project to a GitHub repository, then connect that repository to Render.
2. In Render, create a new **Blueprint** from the repo and deploy the `vibegage` web service. It uses `npm ci && npm run build` and `npm start`.
3. In the service’s **Environment** settings, add `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. Add `OPENAI_API_KEY` if you want model summaries; the service can also run with the local fallback summarizer.
4. In Render, add `vibegage.sha-i.com` under the service’s **Custom Domains**. Render will show the DNS record target to use. At your DNS provider, create the requested CNAME for host `vibegage`, then verify the domain in Render.
5. In the Twitch Developer Console, add `https://vibegage.sha-i.com/auth/twitch/callback` as an OAuth redirect URL. The Blueprint already sets `TWITCH_REDIRECT_URI` to that value.
6. When Render finishes deploying and provisions HTTPS, open `https://vibegage.sha-i.com` and authorize the participating Twitch channels.

The Blueprint uses Render’s $0 Free compute plan for an initial preview; the Hobby workspace plan is also free and includes custom domains. The dashboard and OBS overlay send a small WebSocket heartbeat while open, which counts as inbound activity. If no browser or OBS source is connected, Render can spin the service down after 15 minutes; free services may also restart at any time, and Twitch authorizations are held in memory, so a restart requires reconnecting channels ([free service limits](https://render.com/docs/free), [pricing](https://render.com/pricing)).

## What’s in the demo

- **Per-channel pulse:** vibe label and 0–100 intensity score, top three topics, and recent message count.
- **Question catcher:** repeated questions merge with counts and show an `@target`; questions can be marked answered.
- **Agree or split:** summarizes common directions and competing chat reactions.
- **Chat-versus-chat overlay:** transparent, 1920×1080 OBS source with animated leader cards for most motion, most hyped, and most confused.
- **Offline simulator:** generates chat in two to four fake channels so the demo still works before Twitch setup.
- **Live Twitch input:** OAuth authorization, EventSub WebSocket chat subscriptions, token refresh during the server session, and Shared Chat participant tracking.

## Project layout

```text
src/
  server/
    engine.ts       Rolling chat window and structured/local summarizers
    index.ts        Fastify API and dashboard WebSocket
    twitch.ts       Twitch OAuth and EventSub WebSocket client
  client/
    index.html      Streamer dashboard
    app.js          Dashboard rendering
    overlay.html    Transparent OBS browser source
    overlay.js      Overlay scoreboard
scripts/
  simulate.ts       High volume local demo chat
  copy-assets.ts    Copies web assets into the compiled build
.env.example        Local configuration template
```

## Technical notes

- Summaries run every 15 seconds over messages from the last three minutes.
- The 0–100 vibe intensity is the share of recent messages containing cues for that vibe; it is not an AI confidence percentage.
- Dashboard and overlay updates use a local WebSocket at `/ws`.
- Shared Chat may surface the same source message to more than one channel subscription; Vibegage deduplicates Twitch message IDs before summarizing.
- Twitch connection state and authorized channel roster are available at `/api/twitch/status`.
- Twitch documentation: [Chat EventSub subscription requirements](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channel-chat-message), [Shared Chat EventSub types](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channel-shared-chat-session-begin), [EventSub WebSocket flow](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/), and [Twitch chat authentication](https://dev.twitch.tv/docs/chat/authenticating/).
