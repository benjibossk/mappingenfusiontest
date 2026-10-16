// Shared rooms for working on one map with several people.
//
//   ws://<host>:5790/<room>   messages are JSON:
//     {type: "hello", name, key}            first message of a client: its name and the server password
//     {type: "project", project}            the whole project, last writer wins; kept for late joiners
//     {type: "cursor", x, z}                where a mapper is pointing (relayed, not kept)
//   The server adds {from: <client id>, name} to everything it relays and sends {type: "peers", peers}
//   whenever someone joins or leaves.
//
// Security: nothing (map, cursors, names) is sent to a client before it gives the right password.
//   MAPGEN_COLLAB_KEY   server password (at least 12 characters); a random one is printed if missing
//   MAPGEN_COLLAB_HOST  listen address, default 127.0.0.1 (this machine only). Set it to the LAN / VPN
//                       address to share; never expose it openly on the internet without TLS (wss://).
//   MAPGEN_COLLAB_PORT  default 5790
// Wrong passwords are limited per address (5 tries, then 10 minutes blocked). Rooms live in memory only
// and are dropped when the last mapper leaves.

import { WebSocketServer } from "ws";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.MAPGEN_COLLAB_PORT ?? 5790);
const HOST = process.env.MAPGEN_COLLAB_HOST ?? "127.0.0.1";
let KEY = process.env.MAPGEN_COLLAB_KEY ?? "";
if (KEY.length < 12) {
  if (KEY) console.warn("[collab] MAPGEN_COLLAB_KEY is shorter than 12 characters, using a random one");
  KEY = randomBytes(12).toString("base64url");
  console.log(`[collab] password for this session: ${KEY}`);
}
const KEY_HASH = createHash("sha256").update(KEY).digest();
const MAX_MESSAGE = 16 * 1024 * 1024;
const MAX_ROOMS = 50, MAX_PER_ROOM = 16, AUTH_TIMEOUT = 5000;
const MAX_FAILS = 5, BAN_MS = 10 * 60 * 1000;
const rooms = new Map(); // name -> {clients: Map<ws, {id, name}>, project: string | null}
const fails = new Map(); // address -> {n, until}
let nextId = 1;

const wss = new WebSocketServer({ host: HOST, port: PORT, maxPayload: MAX_MESSAGE });

function keyOk(k) {
  return timingSafeEqual(createHash("sha256").update(String(k ?? "")).digest(), KEY_HASH);
}
function peers(room) {
  return [...room.clients.values()].map(({ id, name }) => ({ id, name }));
}
function broadcast(room, data, except) {
  for (const c of room.clients.keys()) if (c !== except && c.readyState === 1) c.send(data);
}
const num = (v) => (Number.isFinite(v) ? Math.round(v) : 0);

wss.on("connection", (ws, req) => {
  const addr = req.socket.remoteAddress ?? "?";
  const f = fails.get(addr);
  if (f && f.until > Date.now()) return ws.close(4003, "blocked");
  const roomName = decodeURIComponent((req.url ?? "/").slice(1)).replace(/[^\w .-]/g, "").slice(0, 64) || "default";
  const me = { id: nextId++, name: "?" };
  let room = null;
  const timer = setTimeout(() => { if (!room) ws.close(4001, "auth"); }, AUTH_TIMEOUT);

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (!room) {
      // only a hello with the right password opens the room
      if (m.type !== "hello" || !keyOk(m.key)) {
        const e = fails.get(addr) ?? { n: 0, until: 0 };
        e.n++;
        if (e.n >= MAX_FAILS) { e.n = 0; e.until = Date.now() + BAN_MS; }
        fails.set(addr, e);
        return ws.close(4001, "wrong password");
      }
      fails.delete(addr);
      if (!rooms.has(roomName)) {
        if (rooms.size >= MAX_ROOMS) return ws.close(4008, "too many rooms");
        rooms.set(roomName, { clients: new Map(), project: null });
      }
      const r = rooms.get(roomName);
      if (r.clients.size >= MAX_PER_ROOM) return ws.close(4008, "room full");
      clearTimeout(timer);
      room = r;
      me.name = String(m.name ?? "?").replace(/[<>&"']/g, "").slice(0, 32);
      room.clients.set(ws, me);
      ws.send(JSON.stringify({ type: "welcome", id: me.id, room: roomName }));
      if (room.project) ws.send(room.project);
      broadcast(room, JSON.stringify({ type: "peers", peers: peers(room) }));
      return;
    }
    let out;
    if (m.type === "project") out = JSON.stringify({ type: "project", project: m.project, from: me.id, name: me.name });
    else if (m.type === "cursor") out = JSON.stringify({ type: "cursor", x: num(m.x), z: num(m.z), from: me.id, name: me.name });
    else return;
    if (m.type === "project") room.project = out;
    broadcast(room, out, ws);
  });

  ws.on("close", () => {
    clearTimeout(timer);
    if (!room) return;
    room.clients.delete(ws);
    broadcast(room, JSON.stringify({ type: "peers", peers: peers(room) }));
    broadcast(room, JSON.stringify({ type: "cursor", from: me.id, gone: true }));
    if (room.clients.size === 0) rooms.delete(roomName);
  });
});

console.log(`[collab] ws://${HOST}:${PORT}/<room>${HOST === "127.0.0.1" ? "  (this machine only, set MAPGEN_COLLAB_HOST to share)" : ""}`);
