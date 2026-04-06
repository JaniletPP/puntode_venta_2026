import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { authenticate, signUserToken } from '../middleware/auth.js';
import { selectUsuarioByEmailForLogin } from '../lib/authQueries.js';

const router = express.Router();

const SALT_ROUNDS = 10;

router.post('/login', async (req, res) => {
    try {
        const email = String(req.body?.email || '')
            .trim()
            .toLowerCase();
        const password = String(req.body?.password || '');

        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }

        const rows = await selectUsuarioByEmailForLogin(email);
        if (!rows.length) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const u = rows[0];
        if (!u.password_hash) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }
        const ok = await bcrypt.compare(password, u.password_hash);
        if (!ok) {
            return res.status(401).json({ error: 'Credenciales incorrectas' });
        }

        const token = signUserToken(u.id);
        const rol = String(u.rol || 'cajero').toLowerCase();

        res.json({
            token,
            user: {
                id: u.id,
                email: u.email,
                nombre: u.nombre,
                rol,
                negocio_id: u.negocio_id || 'negocio_default',
                negocio_nombre: u.negocio_nombre || null,
            },
        });
    } catch (err) {
        console.error('Login:', err);
        res.status(500).json({
            error: 'Error al iniciar sesión',
            detail: process.env.NODE_ENV === 'development' ? String(err?.message || err) : undefined,
        });
    }
});

router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user });
});

/** Registro interno (opcional). En producción restringir o desactivar. */
router.post('/register', async (req, res) => {
    try {
        if (process.env.ALLOW_REGISTER !== 'true') {
            return res.status(403).json({ error: 'Registro deshabilitado' });
        }
        const email = String(req.body?.email || '')
            .trim()
            .toLowerCase();
        const password = String(req.body?.password || '');
        const nombre = req.body?.nombre?.trim() || null;
        const rol = String(req.body?.rol || 'cajero').toLowerCase();
        const negocio_id = String(req.body?.negocio_id || 'negocio_default').trim();

        if (!email || !password) {
            return res.status(400).json({ error: 'Email y contraseña son requeridos' });
        }

        const allowed = ['admin', 'supervisor', 'cajero', 'mesero'];
        if (!allowed.includes(rol)) {
            return res.status(400).json({ error: 'Rol inválido' });
        }

        const { v4: uuidv4 } = await import('uuid');
        const id = uuidv4();
        const hash = await bcrypt.hash(password, SALT_ROUNDS);

        await pool.execute(
            `INSERT INTO usuarios (id, email, password_hash, nombre, rol, negocio_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, email, hash, nombre, rol, negocio_id || 'negocio_default'],
        );

        const token = signUserToken(id);
        res.status(201).json({
            token,
            user: { id, email, nombre, rol, negocio_id: negocio_id || 'negocio_default' },
        });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'El email ya está registrado' });
        }
        console.error('Register:', err);
        res.status(500).json({ error: 'Error al registrar' });
    }
});

export default router;
