import jwt from 'jsonwebtoken';
import { selectUsuarioByIdForAuth } from '../lib/authQueries.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar-en-produccion';
// Por defecto NO permitir anónimo. Solo si AUTH_ALLOW_ANONYMOUS=true explícitamente.
const ALLOW_ANONYMOUS = String(process.env.AUTH_ALLOW_ANONYMOUS || '')
    .trim()
    .toLowerCase() === 'true';

/**
 * Carga req.user desde Bearer JWT o modo anónimo (rol cajero) si AUTH_ALLOW_ANONYMOUS no es false.
 */
export async function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    const token =
        authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
            ? authHeader.slice(7).trim()
            : null;

    if (!token) {
        if (ALLOW_ANONYMOUS) {
            req.user = {
                id: null,
                email: null,
                nombre: null,
                rol: 'cajero',
                negocio_id: 'negocio_default',
                anonymous: true,
            };
            return next();
        }
        return res.status(401).json({ error: 'No autorizado' });
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const userId = payload.sub;
        const rows = await selectUsuarioByIdForAuth(userId);
        if (!rows.length) {
            return res.status(401).json({ error: 'Usuario no válido' });
        }
        const u = rows[0];
        req.user = {
            id: u.id,
            email: u.email,
            nombre: u.nombre,
            rol: String(u.rol || 'cajero').toLowerCase(),
            negocio_id: u.negocio_id || 'negocio_default',
            negocio_nombre: u.negocio_nombre || null,
            anonymous: false,
        };
        return next();
    } catch {
        return res.status(401).json({ error: 'Token inválido o expirado' });
    }
}

export function signUserToken(userId) {
    const expiresIn = String(process.env.JWT_EXPIRES_IN || '30d').trim() || '30d';
    return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn });
}

export { JWT_SECRET };
