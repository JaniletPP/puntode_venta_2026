import express from 'express';
import pool from '../config/database.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const SALT_ROUNDS = 10;
const VALID_ROLES = ['admin', 'superadmin', 'supervisor', 'cajero', 'mesero'];

function isSuperadmin(req) {
    return String(req.user?.rol || '').toLowerCase() === 'superadmin';
}
function isAdmin(req) {
    return String(req.user?.rol || '').toLowerCase() === 'admin';
}
function canManageUsers(req) {
    return isSuperadmin(req) || isAdmin(req);
}

function isGlobalAdmin(req) {
    const r = String(req.user?.rol || '').toLowerCase();
    return r === 'superadmin';
}

function resolveScopeNegocioId(req) {
    const role = String(req.user?.rol || '').toLowerCase();
    if (role === 'cajero' || role === 'mesero') return req.user?.negocio_id || 'negocio_default';
    if (isGlobalAdmin(req)) {
        const fromHeader = String(req.headers['x-negocio-id'] || '').trim();
        if (!fromHeader || fromHeader.toLowerCase() === 'all') return null;
        return fromHeader;
    }
    return req.user?.negocio_id || 'negocio_default';
}

/** GET /api/usuarios — listado (sin contraseña). Admin: solo su negocio. Superadmin: todos. */
router.get('/', async (req, res) => {
    try {
        const role = String(req.user?.rol || '').toLowerCase();
        const scopedNegocioId =
            role === 'admin'
                ? (req.user?.negocio_id || 'negocio_default')
                : resolveScopeNegocioId(req);
        const [rows] = !scopedNegocioId
            ? await pool.execute(
                `SELECT u.id, u.email, u.nombre, u.rol, u.negocio_id, u.created_at, n.nombre AS negocio_nombre
                 FROM usuarios u
                 LEFT JOIN negocios n ON n.id = u.negocio_id
                 ORDER BY u.created_at DESC`,
            )
            : await pool.execute(
                `SELECT u.id, u.email, u.nombre, u.rol, u.negocio_id, u.created_at, n.nombre AS negocio_nombre
                 FROM usuarios u
                 LEFT JOIN negocios n ON n.id = u.negocio_id
                 WHERE u.negocio_id = ?
                 ORDER BY u.created_at DESC`,
                [scopedNegocioId],
            );
        res.json(rows);
    } catch (err) {
        console.error('Listar usuarios:', err);
        res.status(500).json({ error: 'Error al listar usuarios' });
    }
});

/** POST /api/usuarios — crear usuario y asignar negocio (superadmin/admin). */
router.post('/', async (req, res) => {
    try {
        if (!canManageUsers(req)) {
            return res.status(403).json({ error: 'No tienes permisos para crear usuarios' });
        }
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        const nombre = String(req.body?.nombre || '').trim() || null;
        const rol = String(req.body?.rol || 'cajero').trim().toLowerCase();
        const requestedNegocioId = String(req.body?.negocio_id || '').trim();

        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }
        if (!VALID_ROLES.includes(rol)) {
            return res.status(400).json({ error: 'Rol inválido' });
        }
        if (rol === 'superadmin') {
            return res.status(403).json({ error: 'No se pueden crear más superadmin' });
        }
        if (isAdmin(req) && (rol === 'admin')) {
            return res.status(403).json({ error: 'Un admin no puede crear otro admin' });
        }

        const negocioId = isSuperadmin(req)
            ? (requestedNegocioId || req.user.negocio_id || 'negocio_default')
            : (req.user.negocio_id || 'negocio_default');

        const [nRows] = await pool.execute('SELECT id FROM negocios WHERE id = ? LIMIT 1', [negocioId]);
        if (!nRows.length) {
            return res.status(400).json({ error: 'Negocio no válido' });
        }

        const hash = await bcrypt.hash(password, SALT_ROUNDS);
        const id = uuidv4();
        await pool.execute(
            'INSERT INTO usuarios (id, email, password_hash, nombre, rol, negocio_id) VALUES (?, ?, ?, ?, ?, ?)',
            [id, email, hash, nombre, rol, negocioId],
        );

        const [rows] = await pool.execute(
            'SELECT id, email, nombre, rol, negocio_id, created_at FROM usuarios WHERE id = ? LIMIT 1',
            [id],
        );
        return res.status(201).json(rows[0]);
    } catch (err) {
        if (err?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'El email ya existe' });
        }
        console.error('Crear usuario:', err);
        return res.status(500).json({ error: 'Error al crear usuario' });
    }
});

/** PUT /api/usuarios/:id — actualizar rol y/o negocio (solo superadmin). */
router.put('/:id', async (req, res) => {
    try {
        if (!isSuperadmin(req)) {
            return res.status(403).json({ error: 'No tienes permisos para modificar usuarios' });
        }
        const userId = String(req.params.id || '').trim();
        const nombre = req.body?.nombre;
        const rol = req.body?.rol != null ? String(req.body.rol).trim().toLowerCase() : undefined;
        const requestedNegocioId = req.body?.negocio_id != null ? String(req.body.negocio_id).trim() : undefined;

        const scopedNegocioId = resolveScopeNegocioId(req);
        const [existingRows] = !scopedNegocioId
            ? await pool.execute('SELECT id, negocio_id FROM usuarios WHERE id = ? LIMIT 1', [userId])
            : await pool.execute('SELECT id, negocio_id FROM usuarios WHERE id = ? AND negocio_id = ? LIMIT 1', [userId, scopedNegocioId]);

        if (!existingRows.length) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        if (rol !== undefined && !VALID_ROLES.includes(rol)) {
            return res.status(400).json({ error: 'Rol inválido' });
        }

        const updates = [];
        const values = [];
        if (nombre !== undefined) {
            updates.push('nombre = ?');
            values.push(String(nombre || '').trim() || null);
        }
        if (rol !== undefined) {
            updates.push('rol = ?');
            values.push(rol);
        }

        if (requestedNegocioId !== undefined) {
            const [nRows] = await pool.execute('SELECT id FROM negocios WHERE id = ? LIMIT 1', [requestedNegocioId]);
            if (!nRows.length) {
                return res.status(400).json({ error: 'Negocio no válido' });
            }
            updates.push('negocio_id = ?');
            values.push(requestedNegocioId);
        }

        if (!updates.length) {
            return res.status(400).json({ error: 'No hay campos para actualizar' });
        }

        values.push(userId);
        await pool.execute(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`, values);

        const [rows] = await pool.execute(
            'SELECT id, email, nombre, rol, negocio_id, created_at FROM usuarios WHERE id = ? LIMIT 1',
            [userId],
        );
        return res.json(rows[0]);
    } catch (err) {
        console.error('Actualizar usuario:', err);
        return res.status(500).json({ error: 'Error al actualizar usuario' });
    }
});

export default router;
