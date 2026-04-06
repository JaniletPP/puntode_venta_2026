import express from 'express';
import pool from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { createPointPaymentIntent, getMercadoPagoAccessToken } from '../services/mercadoPagoPoint.js';
import { completeTransactionIfPaid } from '../lib/paymentCompletion.js';
import {
    roundMoney,
    getTransactionPaymentSummary,
    computeRestante,
    withinEps,
} from '../lib/paymentSummary.js';
import { isBadFieldError } from '../lib/dbErrors.js';

const router = express.Router();
const EPS = 0.02;

function resolveNegocioId(req) {
    const h = req.headers['x-negocio-id'];
    if (h != null && String(h).trim() !== '' && String(h).toLowerCase() !== 'all') {
        return String(h).trim();
    }
    const u = String(req.user?.negocio_id || '').trim();
    return u || 'negocio_default';
}

async function listPagos(connection, transactionId) {
    const exec = connection?.execute?.bind(connection) || pool.execute.bind(pool);
    try {
        const [pagos] = await exec(
            `SELECT id, transaction_id, tipo, metodo, monto, referencia, referencia_externa,
                    estado, card_id, created_at
             FROM pagos
             WHERE transaction_id = ?
             ORDER BY created_at ASC`,
            [transactionId],
        );
        return pagos;
    } catch (err) {
        if (!isBadFieldError(err)) throw err;
        console.warn('[pagos] listPagos: faltan columnas MP (005). Devolviendo filas sin estado/referencia_externa.');
        const [pagos] = await exec(
            `SELECT id, transaction_id, tipo, metodo, monto, referencia, card_id, created_at
             FROM pagos
             WHERE transaction_id = ?
             ORDER BY created_at ASC`,
            [transactionId],
        );
        return pagos.map((p) => ({
            ...p,
            referencia_externa: null,
            estado: 'aprobado',
        }));
    }
}

/** INSERT compatible con esquema antes/después de migración 005 y sin negocio_id. */
async function insertPagoRow(connection, row) {
    const {
        pagoId, negocioId, transaction_id, tipo, metodo, monto, referencia,
        referenciaExterna, estado, cardIdDb,
    } = row;
    const attempts = [
        () => connection.execute(
            `INSERT INTO pagos (id, negocio_id, transaction_id, tipo, metodo, monto, referencia, referencia_externa, estado, card_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                pagoId, negocioId, transaction_id, tipo, metodo, monto,
                referencia || null, referenciaExterna, estado, cardIdDb,
            ],
        ),
        () => connection.execute(
            `INSERT INTO pagos (id, negocio_id, transaction_id, tipo, metodo, monto, referencia, card_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [pagoId, negocioId, transaction_id, tipo, metodo, monto, referencia || null, cardIdDb],
        ),
        () => connection.execute(
            `INSERT INTO pagos (id, transaction_id, tipo, metodo, monto, referencia, card_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [pagoId, transaction_id, tipo, metodo, monto, referencia || null, cardIdDb],
        ),
    ];
    let lastErr;
    for (const fn of attempts) {
        try {
            await fn();
            return;
        } catch (e) {
            lastErr = e;
            if (!isBadFieldError(e)) throw e;
        }
    }
    throw lastErr;
}

async function updatePagoReferenciaExterna(connection, pagoId, refExt) {
    try {
        await connection.execute(
            'UPDATE pagos SET referencia_externa = ? WHERE id = ?',
            [refExt, pagoId],
        );
    } catch (e) {
        if (!isBadFieldError(e)) throw e;
        console.warn('[pagos] sin columna referencia_externa; omitir UPDATE.');
    }
}

async function markPagoRechazado(connection, pagoId, msg) {
    const ref = String(msg || '').slice(0, 120);
    try {
        await connection.execute(
            `UPDATE pagos SET estado = 'rechazado', referencia = COALESCE(?, referencia) WHERE id = ?`,
            [ref, pagoId],
        );
    } catch (e) {
        if (!isBadFieldError(e)) throw e;
        await connection.execute(
            'UPDATE pagos SET referencia = ? WHERE id = ?',
            [ref, pagoId],
        );
    }
}

async function countPagosBloqueanCancelacion(connection, transactionId) {
    try {
        const [cnt] = await connection.execute(
            `SELECT COUNT(*) AS n FROM pagos WHERE transaction_id = ? AND estado = 'aprobado'`,
            [transactionId],
        );
        return Number(cnt[0]?.n);
    } catch (e) {
        if (!isBadFieldError(e)) throw e;
        const [cnt] = await connection.execute(
            `SELECT COUNT(*) AS n FROM pagos WHERE transaction_id = ?`,
            [transactionId],
        );
        return Number(cnt[0]?.n);
    }
}

function normalizePaymentInput(body) {
    if (Array.isArray(body?.pagos) && body.pagos.length > 0) {
        return body.pagos.map((p) => ({
            metodo_pago: String(p?.metodo_pago || p?.tipo || '').trim().toLowerCase(),
            monto: Number(p?.monto ?? p?.total ?? 0),
            numero_tarjeta: String(p?.numero_tarjeta || '').trim(),
            referencia: String(p?.referencia || '').trim(),
            metodo: String(p?.metodo || '').trim(),
        }));
    }
    return [
        {
            metodo_pago: String(body?.metodo_pago || '').trim().toLowerCase(),
            monto: Number(body?.total ?? 0),
            numero_tarjeta: String(body?.numero_tarjeta || '').trim(),
            referencia: String(body?.referencia || '').trim(),
            metodo: String(body?.metodo || '').trim(),
        },
    ];
}

async function loadTransactionScoped(connection, transactionId, negocioId) {
    const [rows] = await connection.execute(
        'SELECT id, negocio_id, type, amount, status FROM transacciones WHERE id = ? LIMIT 1',
        [transactionId],
    );
    if (!rows.length) return null;
    const tx = rows[0];
    if (String(tx.negocio_id) !== String(negocioId)) return null;
    return tx;
}

/**
 * POST /api/payments/transaction/start
 * Crea venta en estado pending + ítems. Luego se cobra por /create (parcial).
 */
router.post('/transaction/start', async (req, res) => {
    const negocioId = resolveNegocioId(req);

    const total = roundMoney(req.body?.total);
    const description = String(req.body?.description || 'Venta POS').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!total || total <= 0) {
        return res.status(400).json({ error: 'total inválido' });
    }
    if (!items.length) {
        return res.status(400).json({ error: 'Debes enviar ítems de la venta' });
    }

    const txId = uuidv4();
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        await connection.execute(
            `INSERT INTO transacciones (id, negocio_id, type, amount, card_id, card_number, description, status)
             VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending')`,
            [txId, negocioId, 'sale', total, description || null],
        );

        for (const item of items) {
            const itemId = uuidv4();
            await connection.execute(
                `INSERT INTO transaccion_items (id, transaction_id, product_id, product_name, quantity, unit_price, total)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    itemId,
                    txId,
                    item.product_id || null,
                    item.product_name || item.name || 'Producto',
                    Number(item.quantity || 0),
                    Number(item.unit_price || item.price || 0),
                    Number(item.total || 0),
                ],
            );
        }

        await connection.commit();
        return res.status(201).json({
            success: true,
            transaction_id: txId,
            amount: total,
            status: 'pending',
        });
    } catch (error) {
        if (connection) try { await connection.rollback(); } catch {}
        console.error('Error en /transaction/start:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al iniciar la venta',
            detail: process.env.NODE_ENV === 'development' ? String(error?.message || error) : undefined,
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * GET /api/payments/transaction/:transactionId/summary
 */
router.get('/transaction/:transactionId/summary', async (req, res) => {
    const negocioId = resolveNegocioId(req);
    const { transactionId } = req.params;

    try {
        const [txRows] = await pool.execute(
            'SELECT id, amount, status, negocio_id FROM transacciones WHERE id = ? LIMIT 1',
            [transactionId],
        );
        if (!txRows.length || String(txRows[0].negocio_id) !== String(negocioId)) {
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }
        const tx = txRows[0];
        const pagos = await listPagos(pool, transactionId);
        const { totalAprobado, totalPendiente } = await getTransactionPaymentSummary(pool, transactionId);
        const restante = computeRestante(tx.amount, totalAprobado, totalPendiente);

        return res.json({
            transaction_id: transactionId,
            amount: roundMoney(tx.amount),
            status: String(tx.status || 'pending'),
            pagos,
            total_aprobado: totalAprobado,
            total_pendiente: totalPendiente,
            restante,
        });
    } catch (error) {
        console.error('Error en GET /payments/transaction/:id/summary:', error);
        return res.status(500).json({
            error: 'Error al obtener estado del cobro',
            detail: process.env.NODE_ENV === 'development' ? String(error?.message || error) : undefined,
        });
    }
});

/**
 * POST /api/payments/transaction/:transactionId/cancel
 * Solo si no hay pagos aprobados (evita borrar ventas ya cobradas parcialmente).
 */
router.post('/transaction/:transactionId/cancel', async (req, res) => {
    const negocioId = resolveNegocioId(req);
    const { transactionId } = req.params;

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();
        const tx = await loadTransactionScoped(connection, transactionId, negocioId);
        if (!tx) {
            await connection.rollback();
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }
        if (String(tx.status) === 'completed') {
            await connection.rollback();
            return res.status(400).json({ error: 'La venta ya está completada' });
        }

        const nBloquea = await countPagosBloqueanCancelacion(connection, transactionId);
        if (nBloquea > 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'No se puede cancelar: ya hay pagos aprobados' });
        }

        await connection.execute('DELETE FROM pagos WHERE transaction_id = ?', [transactionId]);
        await connection.execute('DELETE FROM transaccion_items WHERE transaction_id = ?', [transactionId]);
        await connection.execute('DELETE FROM transacciones WHERE id = ?', [transactionId]);
        await connection.commit();
        return res.json({ success: true, cancelled: true });
    } catch (error) {
        if (connection) try { await connection.rollback(); } catch {}
        console.error('Error en cancel:', error);
        return res.status(500).json({
            error: 'Error al cancelar',
            detail: process.env.NODE_ENV === 'development' ? String(error?.message || error) : undefined,
        });
    } finally {
        if (connection) connection.release();
    }
});

/**
 * POST /api/payments/create
 * Pago parcial: efectivo/interna → aprobado de inmediato; externa (Point) → pendiente hasta webhook.
 */
router.post('/create', async (req, res) => {
    const negocioId = resolveNegocioId(req);

    const transaction_id = String(req.body?.transaction_id || '').trim();
    const metodo = String(req.body?.metodo || '').trim().toLowerCase();
    const monto = roundMoney(req.body?.monto);
    const numero_tarjeta = String(req.body?.numero_tarjeta || '').trim();
    const card_id = String(req.body?.card_id || '').trim();
    const referencia = String(req.body?.referencia || '').trim();
    const metodo_detalle = String(req.body?.metodo_detalle || req.body?.metodo || '').trim();
    const deviceId = String(req.body?.device_id || process.env.MERCADOPAGO_POINT_DEVICE_ID || '').trim();

    const allowed = ['efectivo', 'tarjeta_externa', 'tarjeta_interna'];
    if (!transaction_id) return res.status(400).json({ error: 'transaction_id requerido' });
    if (!allowed.includes(metodo)) return res.status(400).json({ error: 'metodo inválido' });
    if (!monto || monto <= 0) return res.status(400).json({ error: 'monto inválido' });

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const tx = await loadTransactionScoped(connection, transaction_id, negocioId);
        if (!tx) {
            await connection.rollback();
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }
        if (String(tx.status) === 'completed') {
            await connection.rollback();
            return res.status(400).json({ error: 'La venta ya está completada' });
        }

        const totalVenta = roundMoney(tx.amount);
        const { totalAprobado, totalPendiente } = await getTransactionPaymentSummary(connection, transaction_id);
        const restante = computeRestante(totalVenta, totalAprobado, totalPendiente);
        if (monto - restante > EPS) {
            await connection.rollback();
            return res.status(400).json({
                error: 'El monto excede lo restante',
                restante,
                total_aprobado: totalAprobado,
                total_pendiente: totalPendiente,
            });
        }

        const pagoId = uuidv4();
        let cardIdDb = null;
        let estado = 'aprobado';
        let referenciaExterna = null;
        let saldoRestante = null;

        if (metodo === 'tarjeta_interna') {
            let card = null;
            if (card_id) {
                const [crows] = await connection.execute(
                    'SELECT id, card_number, balance, status FROM tarjetas WHERE id = ? AND negocio_id = ? LIMIT 1',
                    [card_id, negocioId],
                );
                card = crows[0];
            } else if (numero_tarjeta) {
                const [crows] = await connection.execute(
                    'SELECT id, card_number, balance, status FROM tarjetas WHERE card_number = ? AND negocio_id = ? LIMIT 1',
                    [numero_tarjeta, negocioId],
                );
                card = crows[0];
            }
            if (!card) {
                await connection.rollback();
                return res.status(400).json({ error: 'Tarjeta interna no encontrada' });
            }
            if (String(card.status || '').toLowerCase() !== 'active') {
                await connection.rollback();
                return res.status(400).json({ error: 'Tarjeta interna inactiva' });
            }
            cardIdDb = card.id;
            if (Number(card.balance || 0) + 1e-9 < monto) {
                await connection.rollback();
                return res.status(400).json({ error: 'Saldo insuficiente en tarjeta interna' });
            }
            await connection.execute(
                'UPDATE tarjetas SET balance = balance - ? WHERE id = ? AND negocio_id = ?',
                [monto, cardIdDb, negocioId],
            );
            const [bal] = await connection.execute(
                'SELECT balance FROM tarjetas WHERE id = ? AND negocio_id = ? LIMIT 1',
                [cardIdDb, negocioId],
            );
            saldoRestante = bal.length ? Number(bal[0].balance || 0) : null;
        }

        let usePoint = false;
        if (metodo === 'tarjeta_externa') {
            const hasMp = Boolean(getMercadoPagoAccessToken() && deviceId);
            const registroManual = Boolean(req.body?.registro_manual);
            usePoint = hasMp && !registroManual;
            if (!usePoint) {
                if (!referencia) {
                    await connection.rollback();
                    return res.status(400).json({
                        error: 'Sin terminal Point: envía referencia (folio del cobro) o registro_manual con MP y device_id.',
                    });
                }
                estado = 'aprobado';
            } else {
                estado = 'pendiente';
            }
        }

        const metodoDescripcion = metodo === 'tarjeta_externa'
            ? (metodo_detalle || (usePoint ? 'Point' : 'manual'))
            : metodo_detalle || null;

        await insertPagoRow(connection, {
            pagoId,
            negocioId,
            transaction_id,
            tipo: metodo,
            metodo: metodoDescripcion,
            monto,
            referencia,
            referenciaExterna,
            estado,
            cardIdDb,
        });

        if (metodo === 'tarjeta_externa' && usePoint) {
            try {
                const mpData = await createPointPaymentIntent({
                    deviceId,
                    amount: monto,
                    externalReference: pagoId,
                    description: String(req.body?.description || 'Venta POS').slice(0, 120),
                });
                const mpId =
                    mpData?.id
                    ?? mpData?.payment_id
                    ?? mpData?.payment?.id
                    ?? null;
                if (mpId) {
                    referenciaExterna = String(mpId);
                    await updatePagoReferenciaExterna(connection, pagoId, referenciaExterna);
                }
            } catch (mpErr) {
                console.error('Mercado Pago Point:', mpErr);
                await markPagoRechazado(connection, pagoId, mpErr.message || 'MP error');
                await connection.commit();
                return res.status(502).json({
                    success: false,
                    error: mpErr.message || 'Error al enviar cobro al terminal',
                    pago_id: pagoId,
                });
            }
        }

        await connection.commit();

        const completion = await completeTransactionIfPaid(transaction_id);
        const summary = await getTransactionPaymentSummary(pool, transaction_id);
        const restanteAfter = computeRestante(
            totalVenta,
            summary.totalAprobado,
            summary.totalPendiente,
        );

        return res.json({
            success: true,
            pago_id: pagoId,
            estado,
            transaction_id,
            monto,
            saldo_tarjeta_interna: saldoRestante,
            waiting_terminal: metodo === 'tarjeta_externa' && usePoint && estado === 'pendiente',
            mensaje:
                metodo === 'tarjeta_externa' && usePoint && estado === 'pendiente'
                    ? 'Inserte o acerque la tarjeta en la terminal. Espere la confirmación.'
                    : 'Pago registrado',
            venta_completada: completion.completed === true,
            total_aprobado: summary.totalAprobado,
            total_pendiente: summary.totalPendiente,
            restante: restanteAfter,
        });
    } catch (error) {
        if (connection) try { await connection.rollback(); } catch {}
        console.error('Error en /payments/create:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al crear el pago',
            detail: process.env.NODE_ENV === 'development' ? String(error?.message || error) : undefined,
        });
    } finally {
        if (connection) connection.release();
    }
});

// POST /api/payments/process — flujo legacy (todo en un solo paso)
router.post('/process', async (req, res) => {
    const negocioId = resolveNegocioId(req);
    const usuarioId = String(req.user?.id || '').trim();
    if (!negocioId || !usuarioId) {
        return res.status(403).json({ error: 'Usuario sin negocio asignado' });
    }

    const total = roundMoney(req.body?.total);
    const description = String(req.body?.description || 'Venta POS').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const pagos = normalizePaymentInput(req.body);

    if (!total || total <= 0) {
        return res.status(400).json({ error: 'total inválido' });
    }
    if (!pagos.length) {
        return res.status(400).json({ error: 'Debes enviar al menos un método de pago' });
    }

    const allowed = ['tarjeta_interna', 'efectivo', 'tarjeta_externa'];
    for (const p of pagos) {
        if (!allowed.includes(p.metodo_pago)) {
            return res.status(400).json({ error: 'metodo_pago inválido' });
        }
        if (!(Number(p.monto) > 0)) {
            return res.status(400).json({ error: 'Monto inválido en línea de pago' });
        }
        if (p.metodo_pago === 'tarjeta_interna' && !p.numero_tarjeta) {
            return res.status(400).json({ error: 'numero_tarjeta requerido para tarjeta interna' });
        }
        if (p.metodo_pago === 'tarjeta_externa' && !p.referencia) {
            return res.status(400).json({ error: 'referencia requerida para tarjeta externa' });
        }
    }

    const sumPagos = roundMoney(pagos.reduce((s, p) => s + Number(p.monto || 0), 0));
    if (!withinEps(sumPagos, total)) {
        return res.status(400).json({ error: 'La suma de pagos debe ser igual al total' });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const internalTotals = {};
        for (const p of pagos) {
            if (p.metodo_pago === 'tarjeta_interna') {
                internalTotals[p.numero_tarjeta] = roundMoney(
                    (internalTotals[p.numero_tarjeta] || 0) + Number(p.monto || 0),
                );
            }
        }

        const cardByNumber = {};
        for (const [numeroTarjeta, totalCharge] of Object.entries(internalTotals)) {
            const [rows] = await connection.execute(
                'SELECT id, card_number, balance, status FROM tarjetas WHERE card_number = ? AND negocio_id = ? LIMIT 1',
                [numeroTarjeta, negocioId],
            );
            if (!rows.length) {
                await connection.rollback();
                return res.status(400).json({ error: `Tarjeta ${numeroTarjeta} no encontrada` });
            }
            const card = rows[0];
            if (String(card.status || '').toLowerCase() !== 'active') {
                await connection.rollback();
                return res.status(400).json({ error: `Tarjeta ${numeroTarjeta} inactiva` });
            }
            if (Number(card.balance || 0) + 1e-9 < Number(totalCharge)) {
                await connection.rollback();
                return res.status(400).json({ error: `Saldo insuficiente en tarjeta ${numeroTarjeta}` });
            }
            cardByNumber[numeroTarjeta] = card;
        }

        const txId = uuidv4();
        const firstInternal = pagos.find((p) => p.metodo_pago === 'tarjeta_interna');
        const primaryCard = firstInternal ? cardByNumber[firstInternal.numero_tarjeta] : null;
        await connection.execute(
            `INSERT INTO transacciones (id, negocio_id, type, amount, card_id, card_number, description, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                txId,
                negocioId,
                'sale',
                total,
                primaryCard?.id || null,
                primaryCard?.card_number || null,
                description || null,
                'completed',
            ],
        );

        for (const item of items) {
            const itemId = uuidv4();
            await connection.execute(
                `INSERT INTO transaccion_items (id, transaction_id, product_id, product_name, quantity, unit_price, total)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    itemId,
                    txId,
                    item.product_id || null,
                    item.product_name || item.name || 'Producto',
                    Number(item.quantity || 0),
                    Number(item.unit_price || item.price || 0),
                    Number(item.total || 0),
                ],
            );
        }

        let saldoRestante = null;
        for (const p of pagos) {
            let cardId = null;
            if (p.metodo_pago === 'tarjeta_interna') {
                const card = cardByNumber[p.numero_tarjeta];
                cardId = card.id;
                await connection.execute(
                    'UPDATE tarjetas SET balance = balance - ? WHERE id = ? AND negocio_id = ?',
                    [Number(p.monto || 0), cardId, negocioId],
                );
                const [rows] = await connection.execute(
                    'SELECT balance FROM tarjetas WHERE id = ? AND negocio_id = ? LIMIT 1',
                    [cardId, negocioId],
                );
                saldoRestante = rows.length ? Number(rows[0].balance || 0) : saldoRestante;
            }
            await insertPagoRow(connection, {
                pagoId: uuidv4(),
                negocioId,
                transaction_id: txId,
                tipo: p.metodo_pago,
                metodo: p.metodo || (p.metodo_pago === 'tarjeta_externa' ? 'terminal' : null),
                monto: Number(p.monto || 0),
                referencia: p.referencia || null,
                referenciaExterna: null,
                estado: 'aprobado',
                cardIdDb: cardId,
            });
        }

        await connection.commit();
        return res.json({
            success: true,
            transaction_id: txId,
            saldo_restante: saldoRestante,
            mensaje: saldoRestante != null ? 'Pago procesado correctamente' : 'Pago registrado correctamente',
        });
    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch {}
        }
        console.error('Error en /api/payments/process:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al procesar pago',
            detail: process.env.NODE_ENV === 'development' ? String(error?.message || error) : undefined,
        });
    } finally {
        if (connection) connection.release();
    }
});

export default router;
