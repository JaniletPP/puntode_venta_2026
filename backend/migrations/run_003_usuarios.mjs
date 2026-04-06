import fs from 'fs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

function cleanPassword(v) {
    const s = String(v ?? '');
    if (s === '""' || s === "''") return '';
    return s.replace(/^['"]|['"]$/g, '');
}

const sql = fs.readFileSync(new URL('./003_create_usuarios.sql', import.meta.url), 'utf8');

const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: cleanPassword(process.env.DB_PASSWORD),
    database: process.env.DB_NAME || 'punto_venta',
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: true,
});

await conn.query(sql);

try {
    await conn.query(
        "ALTER TABLE usuarios ADD COLUMN rol VARCHAR(20) NOT NULL DEFAULT 'cajero' AFTER nombre",
    );
} catch (e) {
    if (e.code !== 'ER_DUP_FIELDNAME' && e.errno !== 1060) throw e;
}

await conn.end();
console.log('Migracion aplicada: tabla usuarios y columna rol');
