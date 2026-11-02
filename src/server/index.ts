import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { VibeEngine, type ChatMessage } from "./engine.js";
import { TwitchManager } from "./twitch.js";

const port = Number(process.env.PORT || 3000);
const app = Fastify({ logger: true });
const engine = new VibeEngine();
const twitch = new TwitchManager(process.env.TWITCH_CLIENT_ID || "", process.env.TWITCH_CLIENT_SECRET || "", process.env.TWITCH_REDIRECT_URI || `http://localhost:${port}/auth/twitch/callback`, engine, () => {});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");
await app.register(fastifyStatic, { root, prefix: "/" });
app.get("/api/snapshot", async () => engine.getSnapshot());
app.get("/api/health", async () => ({ ok: true, timestamp: Date.now() }));
app.get("/api/twitch/status", async () => twitch.status());
app.get("/auth/twitch", async (_request, reply) => {
  try { return reply.redirect(twitch.authorizeUrl()); }
  catch (error) { return reply.code(503).type("text/plain").send(error instanceof Error ? error.message : "Twitch OAuth is not configured."); }
});
app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/auth/twitch/callback", async (request, reply) => {
  if (request.query.error) return reply.code(400).type("text/plain").send(`Twitch authorization was not completed: ${request.query.error}`);
  try {
    const user = await twitch.callback(request.query.code || "", request.query.state || "");
    return reply.type("text/html").send(`<meta charset="utf-8"><meta http-equiv="refresh" content="3;url=/"><title>Vibegage connected</title><body style="font:18px system-ui;background:#100f18;color:#fff;padding:12vh 10vw"><h1>Connected as @${user.login}</h1><p>Chat and Shared Chat EventSub subscriptions are starting. Returning to the dashboard…</p><a href="/" style="color:#c5fa79">Back to dashboard</a></body>`);
  } catch (error) { return reply.code(400).type("text/plain").send(error instanceof Error ? error.message : "Twitch authorization failed."); }
});
app.post<{ Body: ChatMessage }>("/api/messages", async (request, reply) => {
  const { channel, user, text, at } = request.body ?? {};
  if (![channel, user, text].every(value => typeof value === "string" && value.trim())) return reply.code(400).send({ error: "channel, user, and text are required" });
  engine.add({ channel: channel.trim().replace(/^#/, ""), user: user.trim(), text: text.trim().slice(0, 500), at: Number(at) || Date.now() });
  return { accepted: true };
});
app.post<{ Body: { text: string } }>("/api/questions/answered", async request => { engine.markAnswered(request.body?.text || ""); return engine.getSnapshot(); });

const wss = new WebSocketServer({ server: app.server, path: "/ws" });
const publish = (snapshot: unknown) => { const payload = JSON.stringify(snapshot); for (const socket of wss.clients) if (socket.readyState === 1) socket.send(payload); };
wss.on("connection", socket => {
  socket.send(JSON.stringify(engine.getSnapshot()));
  socket.on("message", message => { if (message.toString() === "ping" && socket.readyState === 1) socket.send("pong"); });
});
setInterval(async () => publish(await engine.summarize()), 15_000).unref();
// Send an initial state immediately so the offline dashboard is populated before the first batch.
void engine.summarize().then(publish);
await app.listen({ port, host: "0.0.0.0" });
console.log(`Vibegage dashboard: http://localhost:${port}`);
