/**
 * Crea/actualiza un usuario inicial (admin o superadmin).
 *
 * Uso:
 * - node scripts/seed_admin.mjs
 *
 * Variables:
 * - ADMIN_EMAIL (default: admin@local.test)
 * - ADMIN_PASSWORD (default: admin123)
 * - ADMIN_ROLE (default: admin)  -> valores: admin | superadmin
 *
 * Nota: no elimina otros usuarios; solo upsert por email.
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
const roleRaw = String(process.env.ADMIN_ROLE || 'admin').trim().toLowerCase();
const role = roleRaw === 'superadmin' ? 'superadmin' : 'admin';

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

// Asegurar tablas/columnas mínimas para login multi-negocio.
await conn.execute(`
  CREATE TABLE IF NOT EXISTS negocios (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    tipo VARCHAR(100) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
await conn.execute(
  "INSERT INTO negocios (id, nombre, tipo) SELECT 'negocio_default', 'Negocio principal', 'general' WHERE NOT EXISTS (SELECT 1 FROM negocios WHERE id = 'negocio_default')",
);
try {
  await conn.execute('ALTER TABLE usuarios ADD COLUMN negocio_id VARCHAR(36) NULL AFTER nombre');
} catch (e) {
  // ER_DUP_FIELDNAME: la columna ya existe (ok)
  if (e?.code !== 'ER_DUP_FIELDNAME') throw e;
}

const [existing] = await conn.execute('SELECT id FROM usuarios WHERE email = ? LIMIT 1', [email]);
if (existing.length) {
    await conn.execute(
        'UPDATE usuarios SET password_hash = ?, rol = ?, nombre = ?, negocio_id = ? WHERE email = ?',
        [hash, role, role === 'superadmin' ? 'Superadmin' : 'Administrador', 'negocio_default', email],
    );
} else {
    const id = uuidv4();
    await conn.execute(
        'INSERT INTO usuarios (id, email, password_hash, nombre, rol, negocio_id) VALUES (?, ?, ?, ?, ?, ?)',
        [id, email, hash, role === 'superadmin' ? 'Superadmin' : 'Administrador', role, 'negocio_default'],
    );
}

await conn.end();
console.log(`Usuario listo: ${email} (rol: ${role})`);
