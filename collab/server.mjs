// Shared rooms for working on one map with several people.
//
//   ws://<host>:5790/<room>   messages are JSON:
//     {type: "hello", name}                 sent by a client on join
//     {type: "project", project}            the whole project, last writer wins; kept for late joiners
//     {type: "cursor", x, z}                where a mapper is pointing (relayed, not kept)
//   The server adds {from: <client id>, name} to everything it relays and sends {type: "peers", peers}
//   whenever someone joins or leaves.
//
// Run: npm run collab   (port: MAPGEN_COLLAB_PORT, default 5790). Anyone who can reach the port can join a
// room: run it on a LAN, a VPN or behind your own proxy, not openly on the internet.

import { WebSocketServer } from "ws";

const PORT = Number(process.env.MAPGEN_COLLAB_PORT ?? 5790);
const MAX_MESSAGE = 64 * 1024 * 1024;
const rooms = new Map(); // name -> {clients: Map<ws, {id, name}>, project: string | null}
let nextId = 1;

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_MESSAGE });

function peers(room) {
  return [...room.clients.values()].map(({ id, name }) => ({ id, name }));
}
function broadcast(room, data, except) {
  for (const c of room.clients.keys()) if (c !== except && c.readyState === 1) c.send(data);
}

wss.on("connection", (ws, req) => {
  const name = decodeURIComponent((req.url ?? "/").slice(1)).replace(/[^\w .-]/g, "").slice(0, 64) || "default";
  if (!rooms.has(name)) rooms.set(name, { clients: new Map(), project: null });
  const room = rooms.get(name);
  const me = { id: nextId++, name: "?" };
  room.clients.set(ws, me);
  ws.send(JSON.stringify({ type: "welcome", id: me.id, room: name }));
  if (room.project) ws.send(room.project);

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "hello") {
      me.name = String(m.name ?? "?").slice(0, 32);
      broadcast(room, JSON.stringify({ type: "peers", peers: peers(room) }));
      return;
    }
    if (m.type !== "project" && m.type !== "cursor") return;
    const out = JSON.stringify({ ...m, from: me.id, name: me.name });
    if (m.type === "project") room.project = out;
    broadcast(room, out, ws);
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    broadcast(room, JSON.stringify({ type: "peers", peers: peers(room) }));
    broadcast(room, JSON.stringify({ type: "cursor", from: me.id, gone: true }));
  });
});

console.log(`[collab] ws://0.0.0.0:${PORT}/<room>`);
