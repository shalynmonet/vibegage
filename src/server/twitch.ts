import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import type { VibeEngine } from "./engine.js";

type TwitchUser = { id: string; login: string; display_name: string };
type TwitchToken = { access_token: string; refresh_token: string; expires_in: number; scope: string[]; token_type: string };
type EventMessage = { metadata?: { message_type?: string; subscription_type?: string; message_timestamp?: string }; payload?: any };
type ConnectionInfo = { user: TwitchUser; scopes: string[]; expiresAt: number; socketState: string };
const API = "https://api.twitch.tv/helix";
const OAUTH = "https://id.twitch.tv/oauth2";
const READ_SCOPES = ["user:read:chat", "user:bot", "channel:bot"];

export class TwitchManager {
  private pendingState = new Set<string>();
  private connections = new Map<string, { token: TwitchToken; user: TwitchUser; socket?: WebSocket; socketState: string; expiresAt: number; refreshTimer?: NodeJS.Timeout; retryTimer?: NodeJS.Timeout; subscriptions: Set<string>; reconnecting: boolean }>();
  private participantIds = new Set<string>();
  private sharedSessions = new Map<string, Set<string>>();
  private participantLogins = new Map<string, string>();
  private seenMessages = new Set<string>();
  constructor(private clientId: string, private clientSecret: string, private redirectUri: string, private engine: VibeEngine, private changed: () => void) {}
  get configured() { return Boolean(this.clientId && this.clientSecret && this.redirectUri); }
  authorizeUrl() {
    if (!this.configured) throw new Error("Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and TWITCH_REDIRECT_URI in .env first.");
    const state = randomBytes(24).toString("hex"); this.pendingState.add(state);
    const url = new URL(`${OAUTH}/authorize`);
    url.search = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirectUri, response_type: "code", scope: READ_SCOPES.join(" "), state, force_verify: "true" }).toString();
    return url.toString();
  }
  async callback(code: string, state: string) {
    if (!this.pendingState.delete(state)) throw new Error("OAuth state expired or did not match. Try connecting again.");
    const tokenResponse = await fetch(`${OAUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, code, grant_type: "authorization_code", redirect_uri: this.redirectUri }) });
    if (!tokenResponse.ok) throw new Error(`Twitch token exchange failed (${tokenResponse.status}): ${await tokenResponse.text()}`);
    const token = await tokenResponse.json() as TwitchToken;
    const me = await this.apiGet<TwitchUser[]>("/users", token.access_token);
    const user = me[0]; if (!user) throw new Error("Twitch did not return the authorized account.");
    this.connectUser(user, token);
    return user;
  }
  status() {
    const channels = [...this.connections.values()].map(c => ({ id: c.user.id, login: c.user.login, displayName: c.user.display_name, status: c.socketState, scopes: c.token.scope, expiresAt: c.expiresAt }));
    return { configured: this.configured, channels, activeSharedChannels: [...this.participantIds].map(id => this.loginFor(id) ?? id), requiredScopes: READ_SCOPES };
  }
  private connectUser(user: TwitchUser, token: TwitchToken) {
    const prior = this.connections.get(user.id);
    if (prior?.socket) prior.socket.close();
    if (prior?.refreshTimer) clearTimeout(prior.refreshTimer);
    const connection = { token, user, socketState: "connecting", expiresAt: Date.now() + token.expires_in * 1000, subscriptions: new Set<string>(), reconnecting: false };
    this.connections.set(user.id, connection); this.participantIds.add(user.id); this.changed();
    this.scheduleRefresh(connection);
    this.openSocket(connection, "wss://eventsub.wss.twitch.tv/ws");
  }
  private scheduleRefresh(connection: { token: TwitchToken; user: TwitchUser; socketState: string }) {
    const entry = this.connections.get(connection.user.id);
    if (!entry) return;
    if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
    const delay = Math.max(30_000, connection.token.expires_in * 1000 - 60_000);
    entry.expiresAt = Date.now() + connection.token.expires_in * 1000;
    entry.refreshTimer = setTimeout(async () => {
      try {
        const response = await fetch(`${OAUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, grant_type: "refresh_token", refresh_token: connection.token.refresh_token }) });
        if (!response.ok) throw new Error(`Twitch token refresh failed (${response.status})`);
        connection.token = await response.json() as TwitchToken; this.scheduleRefresh(connection);
      } catch (error) { console.error("Twitch token refresh failed; reconnect that streamer from the dashboard:", error); connection.socketState = "reauthorize"; this.changed(); }
    }, delay);
    entry.refreshTimer.unref();
  }
  private openSocket(connection: { token: TwitchToken; user: TwitchUser; socket?: WebSocket; socketState: string; subscriptions: Set<string>; reconnecting: boolean }, url: string) {
    const socket = new WebSocket(url); connection.socket = socket; connection.socketState = "connecting";
    socket.on("open", () => { connection.socketState = "waiting for Twitch"; this.changed(); });
    socket.on("message", raw => { void this.handleFrame(connection, socket, String(raw)); });
    socket.on("error", error => console.error(`Twitch EventSub (${connection.user.login}):`, error.message));
    socket.on("close", () => {
      if (connection.socket !== socket) return;
      connection.socket = undefined;
      if (connection.reconnecting) { connection.socketState = "reconnecting"; this.changed(); return; }
      connection.socketState = "offline"; this.changed();
      const current = this.connections.get(connection.user.id); if (current !== connection || current.retryTimer) return;
      current.retryTimer = setTimeout(() => { current.retryTimer = undefined; this.openSocket(connection, "wss://eventsub.wss.twitch.tv/ws"); }, 3000); current.retryTimer.unref();
    });
  }
  private async handleFrame(connection: { token: TwitchToken; user: TwitchUser; socket?: WebSocket; socketState: string; subscriptions: Set<string>; reconnecting: boolean }, socket: WebSocket, raw: string) {
    let message: EventMessage; try { message = JSON.parse(raw); } catch { return; }
    const type = message.metadata?.message_type; const payload = message.payload ?? {};
    if (type === "session_welcome") {
      connection.socketState = "connected"; this.changed();
      await this.subscribe(connection, payload.session.id, "channel.chat.message", { broadcaster_user_id: connection.user.id, user_id: connection.user.id });
      for (const kind of ["begin", "update", "end"]) await this.subscribe(connection, payload.session.id, `channel.shared_chat.${kind}`, { broadcaster_user_id: connection.user.id });
    } else if (type === "session_reconnect") {
      connection.reconnecting = true; this.openSocket(connection, payload.session.reconnect_url);
      const next = connection.socket;
      if (next && next !== socket) next.once("open", () => { socket.close(); connection.reconnecting = false; connection.socketState = "connected"; this.changed(); });
    } else if (type === "notification") {
      const eventType = payload.subscription?.type ?? message.metadata?.subscription_type;
      const event = payload.event ?? {};
      if (eventType === "channel.chat.message" && event.message?.text) {
        const dedupeKey = event.source_message_id || event.message_id;
        if (dedupeKey && this.seenMessages.has(dedupeKey)) return;
        if (dedupeKey) { this.seenMessages.add(dedupeKey); if (this.seenMessages.size > 5000) this.seenMessages.delete(this.seenMessages.values().next().value!); }
        const channelId = event.source_broadcaster_user_id || event.broadcaster_user_id;
        this.engine.add({ channel: this.loginFor(channelId) ?? event.source_broadcaster_user_login ?? event.broadcaster_user_login ?? connection.user.login, user: event.chatter_user_login ?? "viewer", text: event.message.text, at: Date.parse(message.metadata?.message_timestamp ?? new Date().toISOString()) });
      } else if (eventType?.startsWith("channel.shared_chat.")) this.handleShared(eventType, event);
    } else if (type === "revocation") {
      connection.socketState = `revoked: ${payload.subscription?.status ?? "unknown"}`; this.changed();
    }
  }
  private handleShared(type: string, event: any) {
    const participants: Array<{ broadcaster_user_id: string; broadcaster_user_login: string }> = event.participants ?? [];
    const sessionId = event.session_id;
    const channelId = event.broadcaster_user_id;
    if (type === "channel.shared_chat.begin" || type === "channel.shared_chat.update") {
      if (sessionId) this.sharedSessions.set(sessionId, new Set(participants.map(p => p.broadcaster_user_id)));
      for (const participant of participants) this.participantLogins.set(participant.broadcaster_user_id, participant.broadcaster_user_login);
    } else if (type === "channel.shared_chat.end") {
      // A host ending the session removes every participant; an individual leaving removes only that channel.
      const participantsInSession = this.sharedSessions.get(sessionId);
      if (channelId === event.host_broadcaster_user_id) this.sharedSessions.delete(sessionId);
      else participantsInSession?.delete(channelId);
    }
    this.participantIds = new Set([...this.sharedSessions.values()].flatMap(group => [...group]));
    this.engine.setActiveChannels([...this.participantIds].map(id => this.loginFor(id) ?? this.participantLogins.get(id) ?? id));
    this.changed();
  }
  private async subscribe(connection: { token: TwitchToken; user: TwitchUser; subscriptions: Set<string> }, sessionId: string, type: string, condition: Record<string, string>) {
    const key = `${type}:${JSON.stringify(condition)}`; if (connection.subscriptions.has(key)) return;
    const response = await fetch(`${API}/eventsub/subscriptions`, { method: "POST", headers: { "Client-Id": this.clientId, Authorization: `Bearer ${connection.token.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type, version: "1", condition, transport: { method: "websocket", session_id: sessionId } }) });
    if (!response.ok && response.status !== 409) { console.error(`Twitch subscription ${type} failed for ${connection.user.login} (${response.status}): ${await response.text()}`); return; }
    connection.subscriptions.add(key);
  }
  private loginFor(id: string) { return this.connections.get(id)?.user.login ?? this.participantLogins.get(id); }
  private async apiGet<T>(path: string, token: string) {
    const response = await fetch(`${API}${path}`, { headers: { "Client-Id": this.clientId, Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Twitch API ${path} failed (${response.status}): ${await response.text()}`);
    const body = await response.json() as { data: T }; return body.data;
  }
}
