const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);

// Cloudflare TURN configuration
const CF_API_KEY = process.env.CF_API_KEY || '';
const CF_TURN_KEY_ID = process.env.CF_TURN_KEY_ID || '';

const db = new Database(path.join(__dirname, 'signaling.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'waiting',
    turn_credentials TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS consent_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_code TEXT REFERENCES sessions(code),
    approved_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_code ON sessions(code);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
`);

const app = express();
app.use(cors({
  origin: (origin, callback) => {
    // Allow file:// and no origin (for local Electron dev or simple tools)
    if (!origin || origin.startsWith('file://')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json());

// Helper to mask PII in logs
function maskIP(ip) {
  if (!ip) return 'unknown';
  return ip.replace(/\d+$/, 'xxx').replace(/:[a-f0-9]+$/i, ':xxxx');
}

function maskCode(code) {
  if (!code) return '********';
  return code.substring(0, 2) + '****' + code.substring(6);
}

// Session and join rate limiting
const creationLimits = new Map();
const joinAttempts = new Map();

setInterval(() => {
  creationLimits.clear();
  joinAttempts.clear();
}, 60000);

app.use((req, _res, next) => {
  const start = Date.now();
  const maskedIP = maskIP(req.ip);
  _res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${_res.statusCode} ${Date.now() - start}ms [IP: ${maskedIP}]`);
  });
  next();
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

const activeSessions = new Map();

function broadcastToSession(code, message, excludeWs) {
  const peers = activeSessions.get(code);
  if (!peers) return;
  const payload = JSON.stringify(message);
  if (peers.host && peers.host !== excludeWs) peers.host.send(payload);
  if (peers.controller && peers.controller !== excludeWs) peers.controller.send(payload);
}

function generateCode() {
  let code;
  while (true) {
    code = Array.from({ length: 8 }, () => crypto.randomInt(0, 10)).join('');
    const existing = db.prepare('SELECT id FROM sessions WHERE code = ?').get(code);
    if (!existing) return code;
  }
}

async function fetchCloudflareIceServers() {
  if (!CF_API_KEY || !CF_TURN_KEY_ID) return [];

  try {
    const resp = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${CF_TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CF_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: 86400 }),
      }
    );

    if (!resp.ok) {
      console.error(`Cloudflare TURN error: ${resp.status} ${resp.statusText}`);
      return [];
    }

    const data = await resp.json();
    const iceServers = data.iceServers || [];

    for (const server of iceServers) {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      server.urls = urls.filter(u => !u.includes(':53') && !u.includes(':53?'));
    }

    return iceServers.filter(s => s.urls && s.urls.length > 0);
  } catch (err) {
    console.error('Failed to generate Cloudflare ICE servers:', err.message);
    return [];
  }
}

// Clean up expired sessions and consent logs every 15 minutes, preserving active ones
setInterval(() => {
  const activeCodes = Array.from(activeSessions.keys());
  let sessionsQuery = "DELETE FROM sessions WHERE expires_at < datetime('now')";
  let logsQuery = "DELETE FROM consent_log WHERE approved_at < datetime('now', '-15 minutes')";

  if (activeCodes.length > 0) {
    const placeholders = activeCodes.map(() => '?').join(',');
    sessionsQuery += ` AND code NOT IN (${placeholders})`;
    logsQuery += ` AND session_code NOT IN (${placeholders})`;
    
    const sessions = db.prepare(sessionsQuery).run(...activeCodes);
    const logs = db.prepare(logsQuery).run(...activeCodes);
    if (sessions.changes > 0 || logs.changes > 0) {
      console.log(`Cleanup: Deleted ${sessions.changes} sessions and ${logs.changes} consent logs (Skipped ${activeCodes.length} active)`);
    }
  } else {
    const sessions = db.prepare(sessionsQuery).run();
    const logs = db.prepare(logsQuery).run();
    if (sessions.changes > 0 || logs.changes > 0) {
      console.log(`Cleanup: Deleted ${sessions.changes} sessions and ${logs.changes} consent logs`);
    }
  }
}, 15 * 60 * 1000);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/session/create', async (req, res) => {
  const ip = req.ip;
  const currentCount = creationLimits.get(ip) || 0;
  if (currentCount >= 5) {
    return res.status(429).json({ error: 'Too many sessions created. Please wait a minute.' });
  }
  creationLimits.set(ip, currentCount + 1);

  const code = generateCode();
  const iceServers = await fetchCloudflareIceServers();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare(
    'INSERT INTO sessions (code, status, turn_credentials, expires_at) VALUES (?, ?, ?, ?)'
  ).run(code, 'waiting', JSON.stringify(iceServers), expiresAt);

  console.log(`Session created: ${maskCode(code)} — turn_servers=${iceServers.length}`);
  res.json({ code, expires_in: 900, turn_servers: iceServers });
});

app.post('/api/session/join/:code', (req, res) => {
  const ip = req.ip;
  const attempts = joinAttempts.get(ip) || 0;
  if (attempts >= 5) {
    return res.status(429).json({ error: 'Too many join attempts. Please wait a minute.' });
  }

  const session = db.prepare('SELECT * FROM sessions WHERE code = ?').get(req.params.code);
  if (!session) {
    joinAttempts.set(ip, attempts + 1);
    return res.status(404).json({ error: 'Invalid session code' });
  }
  if (session.status === 'expired') return res.status(410).json({ error: 'Session expired' });
  if (session.status !== 'waiting') return res.status(400).json({ error: 'Session not available' });

  db.prepare("UPDATE sessions SET status = 'requesting' WHERE code = ?").run(req.params.code);
  console.log(`Session joined: ${maskCode(req.params.code)}`);
  res.json({ status: 'waiting_for_consent' });
});

app.post('/api/session/consent/:code', (req, res) => {
  const code = req.params.code;
  const session = db.prepare('SELECT * FROM sessions WHERE code = ?').get(code);
  if (!session || session.status !== 'requesting') {
    return res.status(400).json({ error: 'Invalid session or state' });
  }

  db.prepare("UPDATE sessions SET status = 'approved' WHERE code = ?").run(code);
  db.prepare('INSERT INTO consent_log (session_code) VALUES (?)').run(code);
  
  broadcastToSession(code, { type: 'status_update', status: 'approved' });
  
  console.log(`Consent approved: ${maskCode(code)}`);
  res.json({ status: 'approved' });
});

app.post('/api/session/end/:code', (req, res) => {
  const code = req.params.code;
  db.prepare("UPDATE sessions SET status = 'ended' WHERE code = ?").run(code);
  broadcastToSession(code, { type: 'status_update', status: 'ended' });
  console.log(`Session ended: ${maskCode(code)}`);
  res.json({ status: 'ended' });
});

app.get('/api/session/status/:code', (req, res) => {
  const session = db.prepare('SELECT status, turn_credentials FROM sessions WHERE code = ?').get(req.params.code);
  if (!session) return res.status(404).json({ error: 'Invalid session code' });

  res.json({
    status: session.status,
    turn_servers: JSON.parse(session.turn_credentials)
  });
});

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  const match = req.url.match(/^\/ws\/session\/(\d{8})$/);
  if (!match) {
    ws.close(4000, 'Invalid path');
    return;
  }

  const code = match[1];
  const dbSession = db.prepare('SELECT status FROM sessions WHERE code = ?').get(code);
  if (!dbSession) {
    ws.close(4004, 'Invalid session code');
    return;
  }

  console.log(`WS connected ${maskIP(ip)} — session ${maskCode(code)}`);

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      switch (data.type) {
        case 'join':
          if (!activeSessions.has(code)) activeSessions.set(code, {});
          const peers = activeSessions.get(code);
          if (data.role === 'host') {
            peers.host = ws;
          } else {
            peers.controller = ws;
            broadcastToSession(code, { type: 'status_update', status: 'controller_joined' }, ws);
          }
          break;
        case 'sdp_offer':
        case 'sdp_answer':
        case 'ice_candidate':
          broadcastToSession(code, data, ws);
          break;
      }
    } catch (err) {
      console.error(`WS error ${maskCode(code)}:`, err.message);
    }
  });

  ws.on('close', () => {
    const peers = activeSessions.get(code);
    if (peers) {
      if (peers.host === ws) delete peers.host;
      if (peers.controller === ws) delete peers.controller;
      if (!peers.host && !peers.controller) activeSessions.delete(code);
    }
    console.log(`WS disconnected ${maskCode(code)}`);
  });

  ws.on('error', (err) => console.error(`WS error ${maskCode(code)}:`, err.message));
});

server.listen(PORT, () => {
  console.log(`GUIShell signaling server running on port ${PORT}`);
  console.log(`Cloudflare TURN: ${CF_API_KEY && CF_TURN_KEY_ID ? 'configured' : 'not configured'}`);
});
