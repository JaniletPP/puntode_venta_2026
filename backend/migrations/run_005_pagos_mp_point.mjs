import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

function cleanPassword(v) {
    const s = String(v ?? '');
    if (s === '""' || s === "''") return '';
    return s.replace(/^['"]|['"]$/g, '');
}

const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: cleanPassword(process.env.DB_PASSWORD),
    database: process.env.DB_NAME || 'punto_venta',
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: true,
});

try {
    const sqlPath = resolve(process.cwd(), 'migrations', '005_pagos_mp_point.sql');
    const sql = await readFile(sqlPath, 'utf8');
    await conn.query(sql);
    console.log('✅ Migración 005_pagos_mp_point aplicada');
} catch (e) {
    if (String(e.message || '').includes('Duplicate column')) {
        console.log('ℹ️ Columnas 005 ya existen, omitiendo');
    } else {
        throw e;
    }
} finally {
    await conn.end();
}
