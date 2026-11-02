const $ = selector => document.querySelector(selector);
const styles = { hyped: ["🔥", "#ff6ba9"], confused: ["🫠", "#8c9cff"], bored: ["🥱", "#9a8dff"], toxic: ["🌶️", "#ff8c70"], chill: ["🌿", "#c5fa79"] };

function render(snapshot) {
  $("#channels").innerHTML = snapshot.channels.length ? snapshot.channels.map(channel => {
    const [emoji, color] = styles[channel.vibe] || styles.chill;
    return `<article class="card" style="--glow:${color}20"><div class="channel">#${escapeHtml(channel.channel)}</div><div class="vibe"><span class="emoji">${emoji}</span>${escapeHtml(channel.vibe)}</div><div class="score" title="Share of recent messages with cues for this vibe">VIBE INTENSITY &nbsp; ${channel.score}/100 · ${channel.messageCount} msgs</div><div class="bar"><i style="width:${channel.score}%;background:${color}"></i></div><div class="topics">${channel.topics.map(topic => `<span class="tag">${escapeHtml(topic)}</span>`).join("") || '<span class="tag">warming up…</span>'}</div></article>`;
  }).join("") : '<article class="card"><div class="channel">NO CHANNELS YET</div><div class="empty">Run the simulator to bring chat to life.</div></article>';
  $("#consensus").textContent = snapshot.consensus || "Waiting for chat…";
  $("#splits").innerHTML = snapshot.split.map(item => `<span class="split">↔ ${escapeHtml(item)}</span>`).join("");
  $("#questions").innerHTML = snapshot.questions.length ? snapshot.questions.map(q => `<div class="question"><div class="qtext">${escapeHtml(q.text)}<div class="target">→ @${escapeHtml(q.target)}</div></div><span class="count">×${q.count}</span>${q.answered ? '<span class="target">ANSWERED ✓</span>' : `<button class="answered" data-question="${escapeAttr(q.text)}">Answered</button>`}</div>`).join("") : '<div class="empty">No questions caught yet — chat, ask away.</div>';
  $("#source").textContent = `SUMMARY: ${snapshot.source.toUpperCase()}`;
  $("#updated").textContent = `UPDATED ${new Date(snapshot.updatedAt).toLocaleTimeString()}`;
  document.querySelectorAll("button[data-question]").forEach(button => button.addEventListener("click", async () => {
    await fetch("/api/questions/answered", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: button.dataset.question }) });
    button.textContent = "ANSWERED ✓"; button.disabled = true;
  }));
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]); }
function escapeAttr(text) { return escapeHtml(text); }
async function connect() {
  try { render(await (await fetch("/api/snapshot")).json()); } catch {}
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  let heartbeat;
  ws.onopen = () => { $("#connection").textContent = "LIVE"; heartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 30_000); };
  ws.onclose = () => { clearInterval(heartbeat); $("#connection").textContent = "RECONNECTING"; setTimeout(connect, 2000); };
  ws.onmessage = event => { if (event.data !== "pong") render(JSON.parse(event.data)); };
}
async function refreshTwitchStatus() {
  try {
    const status = await (await fetch("/api/twitch/status")).json();
    $("#twitch-status").textContent = status.channels.length ? ` ${status.channels.length} channel${status.channels.length === 1 ? "" : "s"} authorized` : "";
    if (!status.configured) $("#connect-twitch").title = "Add Twitch app credentials to .env to enable live chat.";
  } catch {}
}
connect();
refreshTwitchStatus();
setInterval(refreshTwitchStatus, 5000);
