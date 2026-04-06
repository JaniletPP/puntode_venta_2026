import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

/** SSL para MySQL en la nube (p. ej. Aiven: ssl-mode=REQUIRED). Activa con DB_SSL=true */
function buildMysqlSsl() {
    const v = String(process.env.DB_SSL || '').trim().toLowerCase();
    if (v !== 'true' && v !== '1') return undefined;
    const ca = process.env.DB_SSL_CA;
    if (typeof ca === 'string' && ca.trim() !== '') {
        return { ca: ca.trim(), rejectUnauthorized: true };
    }
    return { rejectUnauthorized: true };
}

const ssl = buildMysqlSsl();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'punto_venta',
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ...(ssl ? { ssl } : {}),
};

// Crear pool de conexiones
const pool = mysql.createPool(dbConfig);

// Función para probar la conexión
export async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Conexión a MySQL establecida correctamente');
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Error al conectar con MySQL:', error.message);
        return false;
    }
}

export default pool;
