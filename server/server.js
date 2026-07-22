const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DB_PATH = path.join(__dirname, 'event.db');

const ADMIN_PIN = process.env.ADMIN_PIN || '2468';
if (!process.env.ADMIN_PIN) {
    console.warn('WARNING: Using the default ADMIN_PIN. Set the ADMIN_PIN environment variable before a real event.');
}

const validSessions = new Set();

const loginAttempts = new Map();
const MAX_ATTEMPTS = 3;
const WINDOWS_MS = 3 * 60 * 1000;

function isRateLimited(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.windowStart > WINDOWS_MS) {
        loginAttempts.delete(ip);
        return false;
    }
    return entry.count >= MAX_ATTEMPTS;
}

function recordFailedAttempt(ip) {
    const entry = loginAttempts.get(ip);
    if (!entry || Date.now() - entry.windowStart > WINDOWS_MS) {
        loginAttempts.set(ip, { count: 1, windowStart: Date.now()});
    }else {
        entry.count += 1;
    }
}

function isAuthorized(req) {
    const header = req.headers['authorization'] || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return false;
    return validSessions.has(match[1]);
}

const db = new DatabaseSync(DB_PATH);

db.exec(`
    CREATE TABLE IF NOT EXISTS guests (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Absent',
        lastAction TEXT NOT NULL DEFAULT 'N/A'
    );
`);

const guestCount = db.prepare('SELECT COUNT(*) AS count FROM guests').get().count;
if (guestCount === 0) {
    const seed = db.prepare('INSERT INTO guests (id, name, status, lastAction) VALUES (?, ?, ?, ?)');
    const seedGuests = [
        ['GUEST-001', 'Davy Jones', 'Absent', 'N/A'],
        ['GUEST-002', 'Margarett Diaz', 'Absent', 'N/A'],
        ['GUEST-003', 'Cercii Gonzales', 'Absent', 'N/A'],
        ['GUEST-004', 'Paris Hilton', 'Absent', 'N/A'],
    ];
    for (const g of seedGuests) seed.run(...g);
    console.log(`Seeded ${seedGuests.length} demo guests into a fresh database.`);
}

const GUEST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
 
function generateNextGuestId() {
    const rows = db.prepare('SELECT id FROM guests').all();
    let maxNum = 0;
    for (const row of rows) {
        const match = /^GUEST-(\d+)$/.exec(row.id);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
    return `GUEST-${String(maxNum + 1).padStart(3, '0')}`;
}
 
function timeStamp() {
    return new Date().toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}
 
function toggleStatus(guest, prefix) {
    const action = (guest.status === 'Absent' || guest.status === 'Checked Out')
        ? 'ENTRY'
        : 'EXIT';
    const newStatus = action === 'ENTRY' ? 'Inside' : 'Checked Out';
    const lastAction = `${prefix}${action} at ${timeStamp()}`;
 
    db.prepare('UPDATE guests SET status = ?, lastAction = ? WHERE id = ?')
        .run(newStatus, lastAction, guest.id);
 
    return { ...guest, status: newStatus, lastAction, action };
}
 
function sendJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}
 
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        let size = 0;
        const MAX_BODY_BYTES = 1e6;
 
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }
            data += chunk;
        });
 
        req.on('end', () => {
            if (!data) return resolve({});
            try {
                resolve(JSON.parse(data));
            } catch (e) {
                reject(new Error('Invalid JSON body'));
            }
        });
 
        req.on('error', reject);
    });
}
 
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.mp3': 'audio/mpeg',
};
 
function serveStatic(req, res, pathname) {
    let relativePath = pathname === '/' ? '/index.html' : pathname;
 
    const fullPath = path.join(PUBLIC_DIR, path.normalize(relativePath));
    if (!fullPath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }
 
    fs.readFile(fullPath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }
        const ext = path.extname(fullPath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(content);
    });
}
 

 
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    try {

        if (pathname === 'api/ping' && req.method === 'GET') {
            return sendJson(res, 200, { status: 'ok'});
        }
        
        if (pathname === '/api/login' && req.method === 'POST') {
            const ip = req.socket.remoteAddress;

            if (isRateLimited(ip)) {
                return sendJson(res, 429, { error: 'Too many attempts. Try again in a few minutes.'});
            }

            const body = await readJsonBody(req);
            const pin = (body.pin || '').trim();

            if (pin !== ADMIN_PIN) {
                recordFailedAttempt(ip);
                return sendJson(res, 401, { error: 'Invalid PIN.'});
            }

            const token = crypto.randomUUID();
            validSessions.add(token);
            return sendJson(res, 200, {token});
        }

        if (pathname === '/api/logout' && req.method === 'POST') {
            const header = req.headers['authorization'] || '';
            const match = /^Bearer (.+)$/.exec(header);
            if (match) validSessions.delete(match[1]);
            return sendJson(res, 200, { loggedOut: true});
        }
 
        if (pathname === '/api/guests' && req.method === 'GET') {
            const guests = db.prepare('SELECT * FROM guests ORDER BY rowid').all();
            return sendJson(res, 200, guests);
        }
 
        if (pathname === '/api/guests' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const name = (body.name || '').trim();
 
            if (!name) {
                return sendJson(res, 400, { error: 'Guest name is required.' });
            }
 
            let id = (body.id || '').trim() || generateNextGuestId();
 
            if (!GUEST_ID_PATTERN.test(id)) {
                return sendJson(res, 400, {
                    error: 'Guest ID can only contain letters, numbers, hyphens, and underscores.'
                });
            }
 
            const existing = db.prepare('SELECT id FROM guests WHERE LOWER(id) = LOWER(?)').get(id);
            if (existing) {
                return sendJson(res, 409, { error: `Guest ID "${id}" is already in use.` });
            }
 
            db.prepare('INSERT INTO guests (id, name, status, lastAction) VALUES (?, ?, ?, ?)')
                .run(id, name, 'Absent', 'N/A');
 
            const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(id);
            return sendJson(res, 201, guest);
        }
 
        const deleteMatch = /^\/api\/guests\/([^/]+)$/.exec(pathname);
        if (deleteMatch && req.method === 'DELETE') {
            const id = decodeURIComponent(deleteMatch[1]);
            const result = db.prepare('DELETE FROM guests WHERE id = ?').run(id);
            if (result.changes === 0) {
                return sendJson(res, 404, { error: 'Guest not found.' });
            }
            return sendJson(res, 200, { deleted: id });
        }
 
        const toggleMatch = /^\/api\/guests\/([^/]+)\/toggle$/.exec(pathname);
        if (toggleMatch && req.method === 'POST') {
            const id = decodeURIComponent(toggleMatch[1]);
            const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(id);
            if (!guest) {
                return sendJson(res, 404, { error: 'Guest not found.' });
            }
            return sendJson(res, 200, toggleStatus(guest, 'MANUAL '));
        }
 
        if (pathname === '/api/scan' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const code = (body.code || '').trim();
            const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(code);
 
            if (!guest) {
                return sendJson(res, 404, { error: 'Unknown QR code.', scanned: code });
            }
            return sendJson(res, 200, toggleStatus(guest, ''));
        }
 
        if (pathname === '/api/reset' && req.method === 'POST') {
            db.prepare("UPDATE guests SET status = 'Absent', lastAction = 'N/A'").run();
            const guests = db.prepare('SELECT * FROM guests ORDER BY rowid').all();
            return sendJson(res, 200, guests);
        }
 
        if (req.method === 'GET') {
            return serveStatic(req, res, pathname);
        }
 
        sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
        console.error(err);
        sendJson(res, 400, { error: err.message || 'Bad request' });
    }
});
 
server.listen(PORT, () => {
    console.log(`QR Event Monitor server running at http://localhost:${PORT}`);
});