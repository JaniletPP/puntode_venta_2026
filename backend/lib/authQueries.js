import pool from '../config/database.js';
import { isBadFieldError, isSchemaCompatError } from './dbErrors.js';

/**
 * Carga usuario para login. Si falta tabla `negocios` o columna `negocio_id`
 * (migración 004 no aplicada), usa consultas compatibles sin 500.
 */
export async function selectUsuarioByEmailForLogin(email) {
    try {
        const [rows] = await pool.execute(
            `SELECT u.id, u.email, u.nombre, u.password_hash, u.rol, u.negocio_id, n.nombre AS negocio_nombre
             FROM usuarios u
             LEFT JOIN negocios n ON n.id = u.negocio_id
             WHERE u.email = ? LIMIT 1`,
            [email],
        );
        return rows;
    } catch (err) {
        if (!isSchemaCompatError(err)) throw err;
        console.warn('[auth] Login: esquema sin multi-negocio completo; use migración 004.', err.code || err.message);
        try {
            const [rows] = await pool.execute(
                `SELECT id, email, nombre, password_hash, rol, negocio_id FROM usuarios WHERE email = ? LIMIT 1`,
                [email],
            );
            return rows.map((r) => ({
                ...r,
                negocio_id: r.negocio_id || 'negocio_default',
                negocio_nombre: null,
            }));
        } catch (err2) {
            if (!isBadFieldError(err2)) throw err2;
            const [rows] = await pool.execute(
                `SELECT id, email, nombre, password_hash, rol FROM usuarios WHERE email = ? LIMIT 1`,
                [email],
            );
            return rows.map((r) => ({
                ...r,
                negocio_id: 'negocio_default',
                negocio_nombre: null,
            }));
        }
    }
}

/** Misma lógica para JWT /auth/me (sin password_hash). */
export async function selectUsuarioByIdForAuth(userId) {
    try {
        const [rows] = await pool.execute(
            `SELECT u.id, u.email, u.nombre, u.rol, u.negocio_id, n.nombre AS negocio_nombre
             FROM usuarios u
             LEFT JOIN negocios n ON n.id = u.negocio_id
             WHERE u.id = ? LIMIT 1`,
            [userId],
        );
        return rows;
    } catch (err) {
        if (!isSchemaCompatError(err)) throw err;
        console.warn('[auth] /me: esquema sin multi-negocio completo; use migración 004.', err.code || err.message);
        try {
            const [rows] = await pool.execute(
                'SELECT id, email, nombre, rol, negocio_id FROM usuarios WHERE id = ? LIMIT 1',
                [userId],
            );
            return rows.map((r) => ({
                ...r,
                negocio_id: r.negocio_id || 'negocio_default',
                negocio_nombre: null,
            }));
        } catch (err2) {
            if (!isBadFieldError(err2)) throw err2;
            const [rows] = await pool.execute(
                'SELECT id, email, nombre, rol FROM usuarios WHERE id = ? LIMIT 1',
                [userId],
            );
            return rows.map((r) => ({
                ...r,
                negocio_id: 'negocio_default',
                negocio_nombre: null,
            }));
        }
    }
}
