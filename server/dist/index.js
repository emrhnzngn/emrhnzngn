import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer, WebSocket } from 'ws';
import { customAlphabet } from 'nanoid';
import rateLimit from 'express-rate-limit';
const app = express();
app.use(cors({ origin: true }));
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(express.json());
app.get('/', (_req, res) => res.send('ok'));
app.get('/health', (_req, res) => {
    res.json({ ok: true });
});
app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
const CODE_TTL_MS = Number(process.env.CODE_TTL_MS || 10 * 60 * 1000); // 10 minutes
const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);
const codeRegistry = new Map();
const createCodeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
});
app.post('/code', createCodeLimiter, (_req, res) => {
    let code = generateCode();
    while (codeRegistry.has(code) || codeToRoom.has(code)) {
        code = generateCode();
    }
    codeRegistry.set(code, { createdAt: Date.now(), used: false });
    res.json({ code, ttlMs: CODE_TTL_MS });
});
function isCodeValid(code) {
    const meta = codeRegistry.get(code);
    if (!meta)
        return false;
    if (Date.now() - meta.createdAt > CODE_TTL_MS) {
        codeRegistry.delete(code);
        return false;
    }
    return true;
}
function markCodeUsed(code) {
    const meta = codeRegistry.get(code);
    if (!meta)
        return;
    meta.used = true;
}
// periodic cleanup for expired codes and empty rooms already exists via ws close; add code cleanup too
setInterval(() => {
    for (const [code, meta] of codeRegistry) {
        if (Date.now() - meta.createdAt > CODE_TTL_MS) {
            codeRegistry.delete(code);
        }
    }
}, 60 * 1000);
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
// Rooms hold up to 2 peers: one sender and one receiver
const codeToRoom = new Map();
function send(ws, message) {
    try {
        ws.send(JSON.stringify(message));
    }
    catch (_) {
        // ignore
    }
}
function broadcastToRoom(code, exclude, message) {
    const sockets = codeToRoom.get(code);
    if (!sockets)
        return;
    for (const peer of sockets) {
        if (peer !== exclude && peer.readyState === WebSocket.OPEN) {
            send(peer, message);
        }
    }
}
function roomPeerCount(code) {
    return codeToRoom.get(code)?.size ?? 0;
}
function canJoin(code, role) {
    const room = codeToRoom.get(code);
    if (!room)
        return true;
    if (room.size >= 2)
        return 'Room is full';
    // ensure only one of each role
    for (const peer of room) {
        if (peer.__meta?.role === role) {
            return `Room already has a ${role}`;
        }
    }
    return true;
}
wss.on('connection', (wsRaw) => {
    const ws = wsRaw;
    ws.isAlive = true;
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(String(data));
        }
        catch {
            send(ws, { type: 'error', message: 'Invalid JSON' });
            return;
        }
        if (msg?.type === 'join') {
            const { code, role } = msg;
            if (!code || (role !== 'sender' && role !== 'receiver')) {
                send(ws, { type: 'error', message: 'Invalid join payload' });
                return;
            }
            // enforce code validity for first join
            let room = codeToRoom.get(code);
            if (!room) {
                if (!isCodeValid(code)) {
                    send(ws, { type: 'error', message: 'Invalid or expired code' });
                    return;
                }
                room = new Set();
                codeToRoom.set(code, room);
                markCodeUsed(code);
            }
            const allowed = canJoin(code, role);
            if (allowed !== true) {
                send(ws, { type: 'error', message: allowed });
                return;
            }
            ws.__meta = { code, role };
            room.add(ws);
            send(ws, { type: 'joined', code, peersInRoom: roomPeerCount(code) });
            broadcastToRoom(code, ws, { type: 'peer-joined', role });
            return;
        }
        if (msg?.type === 'signal') {
            const { code, payload } = msg;
            const fromRole = (ws.__meta?.role ?? 'sender');
            if (!ws.__meta?.code || ws.__meta.code !== code) {
                send(ws, { type: 'error', message: 'Join a room before signaling' });
                return;
            }
            broadcastToRoom(code, ws, { type: 'signal', from: fromRole, payload });
            return;
        }
        send(ws, { type: 'error', message: 'Unknown message type' });
    });
    ws.on('close', () => {
        const code = ws.__meta?.code;
        if (!code)
            return;
        const room = codeToRoom.get(code);
        if (!room)
            return;
        room.delete(ws);
        if (room.size === 0) {
            codeToRoom.delete(code);
        }
        else {
            broadcastToRoom(code, ws, { type: 'peer-left' });
        }
    });
});
// Heartbeat to clean up dead sockets
const interval = setInterval(() => {
    for (const client of wss.clients) {
        if (client.isAlive === false) {
            try {
                client.terminate();
            }
            catch { }
            continue;
        }
        client.isAlive = false;
        try {
            client.ping();
        }
        catch { }
    }
}, 30000);
wss.on('close', () => {
    clearInterval(interval);
});
const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[signaling] listening on http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map