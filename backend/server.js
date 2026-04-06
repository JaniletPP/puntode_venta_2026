import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { testConnection } from './config/database.js';
import productsRouter from './routes/products.js';
import cardsRouter from './routes/cards.js';
import transactionsRouter, { handleCorteCaja } from './routes/transactions.js';
import paymentsRouter from './routes/payments.js';
import paymentsWebhookRouter from './routes/paymentsWebhook.js';
import authRouter from './routes/auth.js';
import usuariosRouter from './routes/usuarios.js';
import negociosRouter from './routes/negocios.js';
import publicTarjetaRouter from './routes/publicTarjeta.js';
import { authenticate } from './middleware/auth.js';
import { authorize, authorizeVentas } from './middleware/authorize.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
}));

// Webhook Mercado Pago: body crudo para verificación / parseo fiable (registrar ANTES de express.json)
app.use(
    '/api/payments/webhook',
    express.raw({ type: ['application/json', 'text/plain', '*/*'], limit: '2mb' }),
    paymentsWebhookRouter,
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Autenticación local (JWT + roles)
app.use('/api/auth', authRouter);

// Consulta de saldo tarjeta interna (público: solo quien conoce el número)
app.use('/api/public/tarjeta', publicTarjetaRouter);

// Rutas protegidas por rol (backend siempre valida)
app.use('/api/usuarios', authenticate, authorize(['admin', 'superadmin']), usuariosRouter);
app.use('/api/negocios', authenticate, authorize(['superadmin']), negociosRouter);
app.get(
    '/api/reports/corte-caja',
    authenticate,
    authorize(['admin', 'supervisor']),
    handleCorteCaja,
);
app.use('/api/transactions', authenticate, authorizeVentas, transactionsRouter);
app.use('/api/ventas', authenticate, authorizeVentas, transactionsRouter);
app.use('/api/payments', authenticate, authorize(['admin', 'cajero']), paymentsRouter);

// Resto de API protegida por sesión (cualquier rol autenticado)
app.use('/api/products', authenticate, productsRouter);
app.use('/api/cards', authenticate, cardsRouter);

// Ruta de salud
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'API funcionando correctamente',
        timestamp: new Date().toISOString()
    });
});

// Manejo de errores
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// Iniciar servidor
async function startServer() {
    // Probar conexión a la base de datos
    const dbConnected = await testConnection();
    
    if (!dbConnected) {
        console.error('❌ No se pudo conectar a la base de datos. Verifica la configuración en .env');
        process.exit(1);
    }

    app.listen(PORT, () => {
        console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
        console.log(`📡 API disponible en http://localhost:${PORT}/api`);
        console.log(`✅ Base de datos conectada: ${process.env.DB_NAME || 'punto_venta'}`);
    });
}

startServer();
