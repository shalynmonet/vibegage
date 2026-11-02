import OpenAI from "openai";
import { z } from "zod";

export type ChatMessage = { channel: string; user: string; text: string; at: number };
export type Question = { text: string; count: number; target: string; answered: boolean };
export type ChannelPulse = { channel: string; vibe: "hyped" | "confused" | "bored" | "toxic" | "chill"; score: number; topics: string[]; messageCount: number };
export type Snapshot = { updatedAt: number; channels: ChannelPulse[]; questions: Question[]; consensus: string; split: string[]; source: string };

const Output = z.object({
  channels: z.array(z.object({ channel: z.string(), vibe: z.enum(["hyped", "confused", "bored", "toxic", "chill"]), score: z.number().min(0).max(100), topics: z.array(z.string()).max(3) })),
  questions: z.array(z.object({ text: z.string(), count: z.number().int().positive(), target: z.string() })),
  consensus: z.string(), split: z.array(z.string())
});

const stop = new Set("the a an and or but is are was were it this that what how why who where when can could do does did to for of in on at with about game play playing chat guys hey lol lmao thei you your we our they them have has just not im its lets let go my me i so really very pls please left right way stay push retreat yes no up down wait trust listen everyone think see get got go like know want one two there here something anything everything".split(" "));
const topicWords = (texts: string[]) => {
  const counts = new Map<string, number>();
  for (const word of texts.join(" ").toLowerCase().match(/[a-z0-9']{3,}/g) ?? []) if (!stop.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word]) => word);
};

function heuristic(messages: ChatMessage[], activeChannels: string[] = []): Snapshot {
  const grouped = new Map<string, ChatMessage[]>();
  for (const message of messages) {
    const channelMessages = grouped.get(message.channel) ?? [];
    channelMessages.push(message);
    grouped.set(message.channel, channelMessages);
  }
  const channelNames = new Set([...activeChannels, ...grouped.keys()]);
  const channels: ChannelPulse[] = [...channelNames].map(channel => {
    const rows = grouped.get(channel) ?? [];
    if (!rows.length) return { channel, vibe: "chill", score: 0, topics: [], messageCount: 0 };
    const texts = rows.map(m => m.text.toLowerCase());
    const countMessages = (pattern: RegExp) => texts.filter(text => pattern.test(text)).length;
    const hype = countMessages(/!|\b(let's go|pog|hype|wow|win|clutch|insane|gg)\b/);
    const confusion = countMessages(/\?|\b(confused|what|wait|huh|how|why)\b/);
    const toxic = countMessages(/\b(stupid|hate|trash|idiot|toxic|kill)\b/);
    const chill = countMessages(/\b(chill|nice|love|relax|cozy|cute)\b/);
    const bored = countMessages(/\b(boring|sleepy|bored|zzz)\b/);
    const scores = { hyped: hype, confused: confusion, toxic, chill, bored };
    const peak = Math.max(...Object.values(scores));
    const vibe = (peak === 0 ? "chill" : Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0]) as ChannelPulse["vibe"];
    const intensity = Math.min(100, Math.round(100 * peak / Math.max(1, rows.length)));
    return { channel, vibe, score: intensity, topics: topicWords(rows.map(m => m.text)), messageCount: rows.length };
  });
  const questionGroups = new Map<string, { text: string; count: number; target: string; answered: boolean }>();
  for (const m of messages) {
    if (!m.text.includes("?") || m.text.length < 8) continue;
    const clean = m.text.replace(/@\w+/g, "").trim();
    const key = clean.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
    const existing = questionGroups.get(key);
    if (existing) existing.count++;
    else questionGroups.set(key, { text: clean, count: 1, target: (m.text.match(/@([\w]+)/)?.[1]) ?? m.channel, answered: false });
  }
  const reactions = new Map<string, Set<string>>();
  for (const m of messages) {
    const direction = m.text.match(/\b(left|right|stay|push|retreat|yes|no|up|down)\b/i)?.[1]?.toLowerCase();
    if (direction) { const set = reactions.get(direction) ?? new Set(); set.add(m.channel); reactions.set(direction, set); }
  }
  const ranked = [...reactions].sort((a, b) => b[1].size - a[1].size);
  const consensus = ranked[0] ? `${ranked[0][1].size}/${channels.length} chats lean ${ranked[0][0]}` : "Chats are reacting across the room";
  const split = ranked.slice(1).filter(([, set]) => set.size).map(([word, set]) => `${set.size} chat${set.size === 1 ? "" : "s"}: ${word}`);
  return { updatedAt: Date.now(), channels, questions: [...questionGroups.values()].sort((a, b) => b.count - a.count).slice(0, 8), consensus, split, source: "offline heuristics" };
}

export class VibeEngine {
  private messages: ChatMessage[] = [];
  private activeChannels: string[] | null = null;
  private snapshot: Snapshot = heuristic([]);
  private client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
  add(message: ChatMessage) { this.messages.push(message); }
  setActiveChannels(channels: string[]) { this.activeChannels = [...new Set(channels)]; }
  markAnswered(text: string) { this.snapshot.questions = this.snapshot.questions.map(q => q.text === text ? { ...q, answered: true } : q); }
  getSnapshot() { return this.snapshot; }
  async summarize() {
    const cutoff = Date.now() - 3 * 60_000;
    this.messages = this.messages.filter(m => m.at >= cutoff);
    if (this.activeChannels !== null) this.messages = this.messages.filter(m => this.activeChannels!.includes(m.channel));
    const base = heuristic(this.messages, this.activeChannels ?? []);
    if (this.client && this.messages.length) {
      try {
        const response = await this.client.chat.completions.create({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          messages: [{ role: "system", content: "Summarize Twitch collab chat from the last few minutes. Return only data matching the supplied JSON schema. Score is vibe intensity from 0 to 100: estimate the percentage of recent messages that express that vibe; do not use the score as AI confidence or message volume. Merge semantically duplicate questions and infer the streamer addressed from @mentions, channel context, and message content. Topics should be meaningful subjects or named items; omit filler, directions such as left/right, generic reactions, and vibe labels. Keep topics short. Avoid repeating abusive chat." }, { role: "user", content: JSON.stringify({ channels: base.channels.map(c => c.channel), messages: this.messages.slice(-700).map(({ channel, user, text }) => ({ channel, user, text })) }) }],
          response_format: { type: "json_schema", json_schema: { name: "vibegage_snapshot", strict: true, schema: { type: "object", additionalProperties: false, properties: { channels: { type: "array", items: { type: "object", additionalProperties: false, properties: { channel: { type: "string" }, vibe: { type: "string", enum: ["hyped", "confused", "bored", "toxic", "chill"] }, score: { type: "number" }, topics: { type: "array", items: { type: "string" } } }, required: ["channel", "vibe", "score", "topics"] } }, questions: { type: "array", items: { type: "object", additionalProperties: false, properties: { text: { type: "string" }, count: { type: "integer" }, target: { type: "string" } }, required: ["text", "count", "target"] } }, consensus: { type: "string" }, split: { type: "array", items: { type: "string" } } }, required: ["channels", "questions", "consensus", "split"] } } }
        });
        const parsed = Output.parse(JSON.parse(response.choices[0].message.content || "{}"));
        this.snapshot = { ...parsed, channels: parsed.channels.map(c => ({ ...c, messageCount: base.channels.find(x => x.channel === c.channel)?.messageCount ?? 0 })), questions: parsed.questions.map(q => ({ ...q, answered: this.snapshot.questions.find(old => old.text === q.text)?.answered ?? false })), updatedAt: Date.now(), source: "OpenAI" };
      } catch (error) { console.warn("OpenAI summary failed; keeping local summary:", error); this.snapshot = { ...base, source: "offline fallback" }; }
    } else this.snapshot = base;
    return this.snapshot;
  }
}
