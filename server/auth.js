// Lightweight signed tokens (HMAC) scoped to a club — login once, token persists on the
// device, validated server-side. No DB session table, no repeated passwords.
import crypto from 'crypto';

const SECRET = process.env.AUTH_SECRET || process.env.PUSH_SECRET || 'dev-secret-change-me';

export function signToken(payload) {
    const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

export function verifyToken(token) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (!sig || sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}

const readToken = (req) =>
    req.get('x-club-token') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');

// Express middleware: caller must hold a manager token for THIS club (req.params.club).
export function requireManager(req, res, next) {
    const p = verifyToken(readToken(req));
    if (!p || p.role !== 'manager' || p.club !== req.params.club) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    req.auth = p;
    next();
}
