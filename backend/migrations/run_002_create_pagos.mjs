import fs from 'fs';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

function cleanPassword(v) {
    const s = String(v ?? '');
    if (s === '""' || s === "''") return '';
    return s.replace(/^['"]|['"]$/g, '');
}

const sql = fs.readFileSync(new URL('./002_create_pagos_table.sql', import.meta.url), 'utf8');

const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: cleanPassword(process.env.DB_PASSWORD),
    database: process.env.DB_NAME || 'punto_venta',
    port: Number(process.env.DB_PORT || 3306),
    multipleStatements: true,
});

await conn.query(sql);
await conn.end();
console.log('Migracion aplicada: tabla pagos');
