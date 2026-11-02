const score = document.querySelector("#score");
const vibeColor = { hyped: "#ff6ba9", confused: "#8c9cff", bored: "#aaa0dc", toxic: "#ff8c70", chill: "#c5fa79" };
function safe(text) { return String(text).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]); }
function leader(channels, key, vibe) {
  const candidates = channels.filter(channel => !vibe || channel.vibe === vibe);
  return candidates.sort((a,b) => b[key] - a[key])[0];
}
function tile(label, channel, metric, color, winner, emptyTitle = "Waiting on chat…", emptyMetric = "chat simulator standing by") {
  return `<article class="tile ${winner ? "winner" : ""}" style="--accent:${color}"><div class="label">${label}</div><div class="streamer">${channel ? `#${safe(channel.channel)}` : emptyTitle}</div><div class="metric">${channel ? metric(channel) : emptyMetric}</div></article>`;
}
function render(data) {
  const channels = data.channels || [];
  const loud = leader(channels, "messageCount");
  const hype = leader(channels, "score", "hyped");
  const confused = leader(channels, "score", "confused");
  score.innerHTML = [
    tile("📣 HEAVIEST MOTION", loud, c => `${c.messageCount} messages · ${c.vibe} vibe`, "#c5fa79", !!loud),
    tile("🔥 HEAVIEST AURA", hype, c => `${c.score}/100 intensity · ${c.topics?.[0] || "good energy"}`, "#ff6ba9", !!hype, channels.length ? "No hype spike yet" : "Waiting on chat…", channels.length ? "chat is chilling for now" : "chat simulator standing by"),
    tile("🫠 MOST CONFUSED", confused, c => `${c.score}/100 intensity · ${c.topics?.[0] || "many questions"}`, "#8c9cff", !!confused, channels.length ? "No confusion spike" : "Waiting on chat…", channels.length ? "chat is following along" : "chat simulator standing by")
  ].join("");
  document.querySelector("#moment").textContent = data.consensus || "THE COLLAB VIBE CHECK";
}
async function connect() {
  try { render(await (await fetch("/api/snapshot")).json()); } catch {}
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws`);
  let heartbeat;
  ws.onopen = () => { heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 30_000); };
  ws.onmessage = event => { if (event.data !== "pong") render(JSON.parse(event.data)); };
  ws.onclose = () => { clearInterval(heartbeat); setTimeout(connect, 2000); };
}
connect();
