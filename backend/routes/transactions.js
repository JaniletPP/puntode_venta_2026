import express from 'express';
import pool from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const isGlobalAdmin = (req) => {
    const r = String(req.user?.rol || '').toLowerCase();
    return r === 'superadmin';
};
const resolveScopeNegocioId = (req) => {
    const role = String(req.user?.rol || '').toLowerCase();
    if (role === 'cajero' || role === 'mesero') return req.user?.negocio_id || 'negocio_default';
    if (isGlobalAdmin(req)) {
        const fromHeader = String(req.headers['x-negocio-id'] || '').trim();
        if (!fromHeader || fromHeader.toLowerCase() === 'all') return null;
        return fromHeader;
    }
    return req.user?.negocio_id || 'negocio_default';
};

const SUM_TOLERANCE = 0.02;

function isMissingPagosTableError(err) {
    const msg = String(err && err.message ? err.message : err);
    const code = err && err.code;
    const errno = err && err.errno;
    return (
        code === 'ER_NO_SUCH_TABLE' ||
        errno === 1146 ||
        /Table .*pagos.*doesn't exist/i.test(msg)
    );
}

async function selectPagosSafe(executor, transactionId) {
    try {
        const [rows] = await executor.execute(
            'SELECT * FROM pagos WHERE transaction_id = ? ORDER BY created_at ASC',
            [transactionId]
        );
        return rows;
    } catch (err) {
        if (isMissingPagosTableError(err)) return [];
        throw err;
    }
}

function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * El POS guarda pagos en `pagos` (no hay payment_method en transacciones).
 * Vista del reporte: efectivo, terminal (tarjeta externa / QR), tarjeta (interna).
 */
function mapPagoTipoToMetodoCorte(tipo) {
    const t = String(tipo || '').trim();
    if (t === 'efectivo' || t === 'recarga') return 'efectivo';
    if (t === 'tarjeta_interna') return 'tarjeta';
    if (t === 'tarjeta_externa' || t === 'qr') return 'terminal';
    return 'terminal';
}

/**
 * GET /api/reports/corte-caja
 * Query: fecha_inicio & fecha_fin, o inicio & fin (YYYY-MM-DD o ISO).
 * Reparte cada pago proporcionalmente entre líneas de la venta por área de producto.
 */
export async function handleCorteCaja(req, res) {
    try {
        const userNegocioId = req.user?.negocio_id;
        if (!userNegocioId) {
            return res.status(403).json({ error: 'Usuario sin negocio asignado' });
        }
        const scopedNegocioId = resolveScopeNegocioId(req);
        const inicio = req.query.inicio ?? req.query.fecha_inicio;
        const fin = req.query.fin ?? req.query.fecha_fin;
        if (!inicio || !fin) {
            return res.status(400).json({
                error: 'Fechas requeridas',
            });
        }

        const s = String(inicio).trim();
        const e = String(fin).trim();
        const startBound = s.length <= 10 ? `${s} 00:00:00` : s;
        const endBound = e.length <= 10 ? `${e} 23:59:59` : e;

        const sqlConArea = `
            SELECT t.id, t.amount, t.type, t.card_id,
                   ti.product_id, ti.product_name,
                   ti.total AS line_total, ti.quantity,
                   COALESCE(NULLIF(TRIM(p.area), ''), 'sin área') AS area
            FROM transacciones t
            INNER JOIN transaccion_items ti ON ti.transaction_id = t.id
            LEFT JOIN productos p ON p.id = ti.product_id
            WHERE t.type = 'sale'
              ${scopedNegocioId ? 'AND t.negocio_id = ?' : ''}
              AND t.created_at >= ? AND t.created_at <= ?`;
        const sqlSinColumnaArea = `
            SELECT t.id, t.amount, t.type, t.card_id,
                   ti.product_id, ti.product_name,
                   ti.total AS line_total, ti.quantity,
                   'sin área' AS area
            FROM transacciones t
            INNER JOIN transaccion_items ti ON ti.transaction_id = t.id
            WHERE t.type = 'sale'
              ${scopedNegocioId ? 'AND t.negocio_id = ?' : ''}
              AND t.created_at >= ? AND t.created_at <= ?`;

        let rows;
        try {
            [rows] = scopedNegocioId
                ? await pool.execute(sqlConArea, [scopedNegocioId, startBound, endBound])
                : await pool.execute(sqlConArea, [startBound, endBound]);
        } catch (err) {
            const msg = String(err && err.message ? err.message : err);
            const code = err && err.code;
            const errno = err && err.errno;
            const missingArea =
                code === 'ER_BAD_FIELD_ERROR' ||
                errno === 1054 ||
                /Unknown column ['`]?area['`]?/i.test(msg);
            if (missingArea) {
                [rows] = scopedNegocioId
                    ? await pool.execute(sqlSinColumnaArea, [scopedNegocioId, startBound, endBound])
                    : await pool.execute(sqlSinColumnaArea, [startBound, endBound]);
            } else {
                throw err;
            }
        }

        const byTx = new Map();
        const qtyByArea = new Map();
        const productAgg = new Map(); // key: product_id|name -> { product_id, name, cantidad, total }

        for (const row of rows) {
            const id = row.id;
            if (!byTx.has(id)) {
                byTx.set(id, {
                    amount: Number(row.amount) || 0,
                    card_id: row.card_id,
                    items: [],
                });
            }
            const lineTotal = Number(row.line_total) || 0;
            const qty = Number(row.quantity) || 0;
            const area = row.area || 'sin área';
            const productId = row.product_id ?? null;
            const productName = String(row.product_name || 'Producto').trim() || 'Producto';
            byTx.get(id).items.push({
                line_total: lineTotal,
                quantity: qty,
                area,
                product_id: productId,
                product_name: productName,
            });
            qtyByArea.set(area, (qtyByArea.get(area) || 0) + qty);

            const key = `${productId ?? ''}__${productName}`;
            if (!productAgg.has(key)) {
                productAgg.set(key, {
                    product_id: productId,
                    nombre: productName,
                    cantidad: 0,
                    total: 0,
                });
            }
            const p = productAgg.get(key);
            p.cantidad += qty;
            p.total = roundMoney(p.total + lineTotal);
        }

        const txIds = [...byTx.keys()];
        let pagosByTx = new Map();
        if (txIds.length > 0) {
            const placeholders = txIds.map(() => '?').join(',');
            let pagosRows = [];
            try {
                const [rowsPagos] = scopedNegocioId
                    ? await pool.execute(
                        `SELECT transaction_id, tipo, monto FROM pagos WHERE negocio_id = ? AND transaction_id IN (${placeholders})`,
                        [scopedNegocioId, ...txIds],
                    )
                    : await pool.execute(
                        `SELECT transaction_id, tipo, monto FROM pagos WHERE transaction_id IN (${placeholders})`,
                        txIds,
                    );
                pagosRows = rowsPagos;
            } catch (err) {
                if (!isMissingPagosTableError(err)) throw err;
            }
            for (const p of pagosRows) {
                const tid = p.transaction_id;
                if (!pagosByTx.has(tid)) pagosByTx.set(tid, []);
                pagosByTx.get(tid).push(p);
            }
        }

        const areaAgg = new Map();

        const ensureArea = (area) => {
            if (!areaAgg.has(area)) {
                areaAgg.set(area, {
                    total: 0,
                    metodos: { efectivo: 0, terminal: 0, tarjeta: 0 },
                });
            }
            return areaAgg.get(area);
        };

        const addToArea = (area, metodoKey, amount) => {
            const a = ensureArea(area);
            const m = roundMoney(amount);
            if (m === 0) return;
            a.total = roundMoney(a.total + m);
            a.metodos[metodoKey] = roundMoney((a.metodos[metodoKey] || 0) + m);
        };

        for (const [txId, tx] of byTx) {
            const items = tx.items;
            const sumLines = items.reduce((s, it) => s + (Number(it.line_total) || 0), 0);
            const saleAmount = Number(tx.amount) > 0 ? Number(tx.amount) : sumLines;
            if (saleAmount <= 0 || sumLines <= 0) continue;

            const pagos = pagosByTx.get(txId) || [];

            if (pagos.length === 0) {
                for (const it of items) {
                    addToArea(it.area, 'tarjeta', it.line_total);
                }
                continue;
            }

            for (const pago of pagos) {
                const key = mapPagoTipoToMetodoCorte(pago.tipo);
                const monto = Number(pago.monto) || 0;
                const frac = monto / saleAmount;
                for (const it of items) {
                    const alloc = (Number(it.line_total) || 0) * frac;
                    addToArea(it.area, key, alloc);
                }
            }
        }

        const areas = [...areaAgg.entries()]
            .map(([area, v]) => ({
                area,
                total: roundMoney(v.total),
                cantidad: qtyByArea.get(area) ?? 0,
                metodos: {
                    efectivo: roundMoney(v.metodos.efectivo),
                    terminal: roundMoney(v.metodos.terminal),
                    tarjeta: roundMoney(v.metodos.tarjeta),
                },
            }))
            .sort((a, b) => String(a.area).localeCompare(String(b.area), 'es'));

        const total_general = roundMoney(areas.reduce((s, a) => s + a.total, 0));
        const total_productos = [...productAgg.values()].reduce((s, p) => s + Number(p.cantidad || 0), 0);
        const productos = [...productAgg.values()]
            .map((p) => ({
                product_id: p.product_id,
                nombre: p.nombre,
                cantidad: Number(p.cantidad || 0),
                total: roundMoney(p.total),
            }))
            .sort((a, b) => Number(b.total || 0) - Number(a.total || 0));

        const metodos_generales = areas.reduce(
            (acc, a) => {
                acc.efectivo = roundMoney(acc.efectivo + Number(a?.metodos?.efectivo || 0));
                acc.terminal = roundMoney(acc.terminal + Number(a?.metodos?.terminal || 0));
                acc.tarjeta = roundMoney(acc.tarjeta + Number(a?.metodos?.tarjeta || 0));
                return acc;
            },
            { efectivo: 0, terminal: 0, tarjeta: 0 },
        );
        const numero_ventas = txIds.length;

        res.json({
            productos,
            areas,
            total_general,
            total_productos,
            metodos_generales,
            numero_ventas,
            periodo: { inicio: s, fin: e },
        });
    } catch (error) {
        console.error('Error corte caja:', error);
        res.status(500).json({
            error: 'Error interno',
            detalle: error.message,
        });
    }
}

// GET /api/transactions - Listar todas las transacciones
router.get('/', async (req, res) => {
    try {
        const userNegocioId = req.user?.negocio_id;
        if (!userNegocioId) return res.status(403).json({ error: 'Usuario sin negocio asignado' });
        const scopedNegocioId = resolveScopeNegocioId(req);
        const [rows] = !scopedNegocioId
            ? await pool.execute(
                'SELECT *, created_at as created_date FROM transacciones ORDER BY created_at DESC'
            )
            : await pool.execute(
                'SELECT *, created_at as created_date FROM transacciones WHERE negocio_id = ? ORDER BY created_at DESC',
                [scopedNegocioId]
            );

        const transactionsWithItems = await Promise.all(
            rows.map(async (transaction) => {
                const [items] = await pool.execute(
                    'SELECT * FROM transaccion_items WHERE transaction_id = ?',
                    [transaction.id]
                );
                const pagosRows = await selectPagosSafe(pool, transaction.id);
                return {
                    ...transaction,
                    items: items,
                    pagos: pagosRows
                };
            })
        );

        res.json(transactionsWithItems);
    } catch (error) {
        console.error('Error al obtener transacciones:', error);
        res.status(500).json({ error: 'Error al obtener transacciones' });
    }
});

// GET /api/transactions/:id - Obtener una transacción por ID
router.get('/:id', async (req, res) => {
    try {
        const userNegocioId = req.user?.negocio_id;
        if (!userNegocioId) return res.status(403).json({ error: 'Usuario sin negocio asignado' });
        const scopedNegocioId = resolveScopeNegocioId(req);
        const [rows] = !scopedNegocioId
            ? await pool.execute(
                'SELECT *, created_at as created_date FROM transacciones WHERE id = ?',
                [req.params.id]
            )
            : await pool.execute(
                'SELECT *, created_at as created_date FROM transacciones WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopedNegocioId]
            );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }

        const transaction = rows[0];
        const [items] = await pool.execute(
            'SELECT * FROM transaccion_items WHERE transaction_id = ?',
            [transaction.id]
        );
        const pagosRows = await selectPagosSafe(pool, transaction.id);

        res.json({
            ...transaction,
            items: items,
            pagos: pagosRows
        });
    } catch (error) {
        console.error('Error al obtener transacción:', error);
        res.status(500).json({ error: 'Error al obtener transacción' });
    }
});

// POST /api/transactions - Crear una nueva transacción
router.post('/', async (req, res) => {
    const userNegocioId = req.user?.negocio_id;
    if (!userNegocioId) return res.status(403).json({ error: 'Usuario sin negocio asignado' });
    const role = String(req.user?.rol || '').toLowerCase();
    const scopedNegocioId = role === 'cajero' || role === 'mesero'
        ? String(userNegocioId).trim()
        : String(req.body?.negocio_id || req.headers['x-negocio-id'] || userNegocioId).trim();
    const {
        type,
        amount,
        card_id,
        card_number,
        description,
        status = 'completed',
        items = [],
        pagos = []
    } = req.body;

    if (!type || amount === undefined) {
        return res.status(400).json({ error: 'type y amount son requeridos' });
    }

    const id = uuidv4();
    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        let primaryCardId = card_id || null;
        let primaryCardNumber = card_number || null;

        // Venta con líneas de pago (negocio real):
        // - tarjeta_interna: validar saldo en BD y descontar (único tipo con movimiento en tarjetas).
        // - tarjeta_externa, efectivo, qr: solo registro en tabla pagos; el cobro físico (terminal, caja, etc.) es ajeno al POS.
        if (type === 'sale' && Array.isArray(pagos) && pagos.length > 0) {
            const saleAmount = Number(amount);
            const sumPagos = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
            if (Math.abs(sumPagos - saleAmount) > SUM_TOLERANCE) {
                await connection.rollback();
                connection.release();
                return res.status(400).json({
                    error: 'La suma de los pagos debe igualar el total de la venta'
                });
            }

            const internalTotals = {};
            for (const p of pagos) {
                if (p.tipo === 'tarjeta_interna') {
                    if (!p.card_id) {
                        await connection.rollback();
                        connection.release();
                        return res.status(400).json({
                            error: 'Cada pago con tarjeta interna debe incluir card_id'
                        });
                    }
                    internalTotals[p.card_id] =
                        (internalTotals[p.card_id] || 0) + Number(p.monto);
                }
            }

            for (const [cid, totalCharge] of Object.entries(internalTotals)) {
                const [rows] = await connection.execute(
                    'SELECT balance, status FROM tarjetas WHERE id = ? AND negocio_id = ?',
                    [cid, scopedNegocioId]
                );
                if (!rows.length || rows[0].status !== 'active') {
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        error: 'Tarjeta interna no encontrada o inactiva'
                    });
                }
                if (Number(rows[0].balance) + 1e-9 < totalCharge) {
                    await connection.rollback();
                    connection.release();
                    return res.status(400).json({
                        error: 'Saldo insuficiente en tarjeta interna'
                    });
                }
            }

            const internals = pagos.filter((p) => p.tipo === 'tarjeta_interna');
            if (internals.length === 1 && !primaryCardId) {
                primaryCardId = internals[0].card_id;
                const [cn] = await connection.execute(
                    'SELECT card_number FROM tarjetas WHERE id = ? AND negocio_id = ?',
                    [primaryCardId, scopedNegocioId]
                );
                if (cn.length) primaryCardNumber = cn[0].card_number;
            }
        }

        await connection.execute(
            `INSERT INTO transacciones (id, negocio_id, type, amount, card_id, card_number, description, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, scopedNegocioId, type, amount, primaryCardId, primaryCardNumber, description || null, status]
        );

        if (items && items.length > 0) {
            for (const item of items) {
                const itemId = uuidv4();
                await connection.execute(
                    `INSERT INTO transaccion_items (id, transaction_id, product_id, product_name, quantity, unit_price, total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        itemId,
                        id,
                        item.product_id || null,
                        item.product_name,
                        item.quantity,
                        item.unit_price,
                        item.total
                    ]
                );
            }
        }

        if (type === 'recharge' && card_id) {
            await connection.execute(
                'UPDATE tarjetas SET balance = balance + ? WHERE id = ? AND negocio_id = ?',
                [amount, card_id, scopedNegocioId]
            );
        }

        if (type === 'sale') {
            let pagosTableAvailable = true;
            if (pagos && pagos.length > 0) {
                for (const pago of pagos) {
                    if (pago.tipo === 'tarjeta_interna') {
                        await connection.execute(
                            'UPDATE tarjetas SET balance = balance - ? WHERE id = ? AND negocio_id = ?',
                            [Number(pago.monto), pago.card_id, scopedNegocioId]
                        );
                    }
                    const pagoId = uuidv4();
                    const metodoGuardado =
                        pago.tipo === 'tarjeta_externa'
                            ? (String(pago.metodo || '').trim() || null)
                            : pago.metodo || null;
                    if (pagosTableAvailable) {
                        try {
                            await connection.execute(
                                `INSERT INTO pagos (id, negocio_id, transaction_id, tipo, metodo, monto, referencia, card_id)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                [
                                    pagoId,
                                    scopedNegocioId,
                                    id,
                                    pago.tipo,
                                    metodoGuardado,
                                    Number(pago.monto),
                                    pago.referencia || null,
                                    pago.tipo === 'tarjeta_interna' ? pago.card_id : null
                                ]
                            );
                        } catch (err) {
                            if (isMissingPagosTableError(err)) {
                                pagosTableAvailable = false;
                            } else {
                                throw err;
                            }
                        }
                    }
                }
            } else if (card_id) {
                await connection.execute(
                    'UPDATE tarjetas SET balance = balance - ? WHERE id = ? AND negocio_id = ?',
                    [amount, card_id, scopedNegocioId]
                );
            }
        }

        await connection.commit();

        const [newTransaction] = await connection.execute(
            'SELECT *, created_at as created_date FROM transacciones WHERE id = ? AND negocio_id = ?',
            [id, scopedNegocioId]
        );

        const [transactionItems] = await connection.execute(
            'SELECT * FROM transaccion_items WHERE transaction_id = ?',
            [id]
        );

        const transactionPagos = await selectPagosSafe(connection, id);

        connection.release();

        res.status(201).json({
            ...newTransaction[0],
            items: transactionItems,
            pagos: transactionPagos
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (_) {
                // ignore
            }
            try {
                connection.release();
            } catch (_) {
                // ignore
            }
        }
        console.error('Error al crear transacción:', error);
        res.status(500).json({ error: 'Error al crear transacción' });
    }
});

// PUT /api/transactions/:id - Actualizar una transacción
router.put('/:id', async (req, res) => {
    try {
        const userNegocioId = req.user?.negocio_id;
        if (!userNegocioId) return res.status(403).json({ error: 'Usuario sin negocio asignado' });
        const scopedNegocioId = resolveScopeNegocioId(req);
        const {
            type,
            amount,
            card_id,
            card_number,
            description,
            status
        } = req.body;

        const [existing] = !scopedNegocioId
            ? await pool.execute(
                'SELECT * FROM transacciones WHERE id = ?',
                [req.params.id]
            )
            : await pool.execute(
                'SELECT * FROM transacciones WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopedNegocioId]
            );

        if (existing.length === 0) {
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }

        const updates = [];
        const values = [];

        if (type !== undefined) { updates.push('type = ?'); values.push(type); }
        if (amount !== undefined) { updates.push('amount = ?'); values.push(amount); }
        if (card_id !== undefined) { updates.push('card_id = ?'); values.push(card_id); }
        if (card_number !== undefined) { updates.push('card_number = ?'); values.push(card_number); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (status !== undefined) { updates.push('status = ?'); values.push(status); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
        }

        if (!scopedNegocioId) {
            values.push(req.params.id);
            await pool.execute(
                `UPDATE transacciones SET ${updates.join(', ')} WHERE id = ?`,
                values
            );
        } else {
            values.push(req.params.id, scopedNegocioId);
            await pool.execute(
                `UPDATE transacciones SET ${updates.join(', ')} WHERE id = ? AND negocio_id = ?`,
                values
            );
        }

        const [updated] = !scopedNegocioId
            ? await pool.execute(
                'SELECT *, created_at as created_date FROM transacciones WHERE id = ?',
                [req.params.id]
            )
            : await pool.execute(
                'SELECT *, created_at as created_date FROM transacciones WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopedNegocioId]
            );

        const [items] = await pool.execute(
            'SELECT * FROM transaccion_items WHERE transaction_id = ?',
            [req.params.id]
        );

        const pagosRows = await selectPagosSafe(pool, req.params.id);

        res.json({
            ...updated[0],
            items: items,
            pagos: pagosRows
        });
    } catch (error) {
        console.error('Error al actualizar transacción:', error);
        res.status(500).json({ error: 'Error al actualizar transacción' });
    }
});

// DELETE /api/transactions/:id - Eliminar una transacción
router.delete('/:id', async (req, res) => {
    try {
        const userNegocioId = req.user?.negocio_id;
        if (!userNegocioId) return res.status(403).json({ error: 'Usuario sin negocio asignado' });
        const scopedNegocioId = resolveScopeNegocioId(req);
        const [result] = !scopedNegocioId
            ? await pool.execute(
                'DELETE FROM transacciones WHERE id = ?',
                [req.params.id]
            )
            : await pool.execute(
                'DELETE FROM transacciones WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopedNegocioId]
            );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Transacción no encontrada' });
        }

        res.json({ message: 'Transacción eliminada correctamente' });
    } catch (error) {
        console.error('Error al eliminar transacción:', error);
        res.status(500).json({ error: 'Error al eliminar transacción' });
    }
});

export default router;
