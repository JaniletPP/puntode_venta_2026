/**
 * Crea usuario admin inicial (ejecutar una vez).
 * Uso: node scripts/seed_admin.mjs
 * Variables opcionales: ADMIN_EMAIL, ADMIN_PASSWORD
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

dotenv.config({ path: './.env' });

function cleanPassword(v) {
    const s = String(v ?? '');
    if (s === '""' || s === "''") return '';
    return s.replace(/^['"]|['"]$/g, '');
}

const email = (process.env.ADMIN_EMAIL || 'admin@local.test').toLowerCase().trim();
const plain = process.env.ADMIN_PASSWORD || 'admin123';

const hash = await bcrypt.hash(plain, 10);

function buildSsl() {
    const v = String(process.env.DB_SSL || '').trim().toLowerCase();
    if (v !== 'true' && v !== '1') return undefined;
    const ca = process.env.DB_SSL_CA;
    if (typeof ca === 'string' && ca.trim() !== '') {
        return { ca: ca.trim(), rejectUnauthorized: true };
    }
    return { rejectUnauthorized: false };
}

const ssl = buildSsl();

const conn = await mysql.createConnection({
    host: String(process.env.DB_HOST || 'localhost').trim(),
    user: String(process.env.DB_USER || 'root').trim(),
    password: cleanPassword(process.env.DB_PASSWORD),
    database: String(process.env.DB_NAME || 'punto_venta').trim(),
    port: Number(process.env.DB_PORT || 3306),
    ...(ssl ? { ssl } : {}),
});

const [existing] = await conn.execute('SELECT id FROM usuarios WHERE email = ? LIMIT 1', [email]);
await conn.execute(
    "INSERT INTO negocios (id, nombre, tipo) SELECT 'negocio_default', 'Negocio principal', 'general' WHERE NOT EXISTS (SELECT 1 FROM negocios WHERE id = 'negocio_default')",
);
if (existing.length) {
    await conn.execute(
        'UPDATE usuarios SET password_hash = ?, rol = ?, nombre = ?, negocio_id = ? WHERE email = ?',
        [hash, 'admin', 'Administrador', 'negocio_default', email],
    );
} else {
    const id = uuidv4();
    await conn.execute(
        'INSERT INTO usuarios (id, email, password_hash, nombre, rol, negocio_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, email, hash, 'Administrador', 'admin', 'negocio_default'],
    );
}

await conn.end();
console.log(`Usuario admin listo: ${email} (ADMIN_PASSWORD o admin123 por defecto)`);
