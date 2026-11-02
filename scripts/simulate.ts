const names = ["pixelpanda", "cozybyte", "dash_dynamo", "mossy_mage"];
const lines = [
  "Pog this is the run!!", "@cozybyte what game is this?", "chat what does this button do?", "GO LEFT GO LEFT", "Nooo go right trust", "wait what is happening lol?", "this soundtrack is actually so good", "we are so back", "this boss is impossible 😭", "@pixelpanda can you explain the build?", "three chats say left, listen to us", "I have never seen this game before", "clutch!!", "why did that work lmao", "are we allowed to pet the little guy?", "Dash has the map, ask them", "the tiny hat is sending me", "right is a trap, chat knows", "everyone breathe we got this", "that was kinda clean", "who is the streamer with the green hoodie?", "this game is so cozy", "chat is divided on the door", "no way no way no way", "I think the key was in the last room"
];
const rate = Math.max(1, Number(process.argv.find(x => x.startsWith("--rate="))?.split("=")[1]) || 8);
const count = Math.max(2, Math.min(4, Number(process.argv.find(x => x.startsWith("--channels="))?.split("=")[1]) || 3));
const offline = process.argv.includes("--offline");
const port = Number(process.env.PORT || 3000);
const endpoints = offline ? [`http://localhost:${port}/api/messages`] : names.slice(0, count).map(channel => `http://localhost:${port}/api/messages`);
console.log(`Vibegage simulator sending to ${count} fake channels at about ${rate} msg/sec. Stop with Ctrl+C.`);
console.log(offline ? "OFFLINE: fake channel names, no Twitch auth or credentials required." : "SIMULATION: fake chat, no Twitch auth or credentials required.");
let sent = 0;
setInterval(() => {
  for (let i = 0; i < rate; i++) {
    const channel = names[Math.floor(Math.random() * count)];
    const text = lines[Math.floor(Math.random() * lines.length)];
    const user = `viewer${Math.floor(Math.random() * 480)}`;
    void fetch(endpoints[0], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, user, text, at: Date.now() }) }).then(response => { if (!response.ok) console.error("Server rejected message:", response.status); }).catch(() => { if (!sent) console.error("Can't reach Vibegage. Start the server first."); });
    sent++;
  }
  if (sent % Math.max(rate, 16) < rate) console.log(`sent ${sent} messages`);
}, 1000);
