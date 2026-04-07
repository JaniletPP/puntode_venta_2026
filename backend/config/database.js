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
    // Aiven (y otros) suelen requerir el PEM del CA en DB_SSL_CA; sin él Node rechaza la cadena ("self-signed certificate in certificate chain").
    console.warn(
        '[db] DB_SSL sin DB_SSL_CA: conexión TLS sin verificar cadena. Para producción pega el CA de Aiven en DB_SSL_CA.',
    );
    return { rejectUnauthorized: false };
}

const ssl = buildMysqlSsl();

const dbConfig = {
    host: String(process.env.DB_HOST || 'localhost').trim(),
    user: String(process.env.DB_USER || 'root').trim(),
    password: String(process.env.DB_PASSWORD || '').trim(),
    database: String(process.env.DB_NAME || 'punto_venta').trim(),
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    ...(ssl ? { ssl } : {}),
};

const pwdSet = Boolean(dbConfig.password);
console.log(
    `[db] MySQL → ${dbConfig.host}:${dbConfig.port} db="${dbConfig.database}" user="${dbConfig.user}" passwordSet=${pwdSet}`,
);

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
        if (error.code) console.error('   code:', error.code);
        if (error.errno) console.error('   errno:', error.errno);
        if (error.sqlState) console.error('   sqlState:', error.sqlState);
        return false;
    }
}

export default pool;
