import express from 'express';
import pool from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { isBadFieldError } from '../lib/dbErrors.js';

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

/** INSERT pagos compatible con esquemas con/sin columnas extra (misma idea que payments.js). */
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

async function insertPagoRecarga(connection, {
    pagoId, negocioId, transactionId, monto, referencia, cardId,
}) {
    try {
        await insertPagoRow(connection, {
            pagoId,
            negocioId,
            transaction_id: transactionId,
            tipo: 'recarga',
            metodo: 'recarga_pos',
            monto,
            referencia: referencia || null,
            referenciaExterna: null,
            estado: 'aprobado',
            cardIdDb: cardId,
        });
    } catch (e) {
        if (String(e?.sqlMessage || e?.message || '').includes('recarga') || e?.errno === 1265) {
            await insertPagoRow(connection, {
                pagoId,
                negocioId,
                transaction_id: transactionId,
                tipo: 'efectivo',
                metodo: 'recarga_tarjeta',
                monto,
                referencia: referencia || null,
                referenciaExterna: null,
                estado: 'aprobado',
                cardIdDb: cardId,
            });
            return;
        }
        throw e;
    }
}

// GET /api/cards — listar (admin / gestión; no usar en POS a gran escala)
router.get('/', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const [rows] = !scopeNegocioId
            ? await pool.execute('SELECT *, created_at as created_date FROM tarjetas ORDER BY created_at DESC')
            : await pool.execute(
                'SELECT *, created_at as created_date FROM tarjetas WHERE negocio_id = ? ORDER BY created_at DESC',
                [scopeNegocioId],
            );
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener tarjetas:', error);
        res.status(500).json({ error: 'Error al obtener tarjetas' });
    }
});

// GET /api/cards/search?q= — búsqueda por número o titular (máx. 20)
router.get('/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (q.length < 2) {
            return res.json([]);
        }
        const scopeNegocioId = resolveScopeNegocioId(req);
        const like = `%${q}%`;
        const limit = 20;
        const [rows] = !scopeNegocioId
            ? await pool.execute(
                `SELECT id, card_number, holder_name, balance, status
                 FROM tarjetas
                 WHERE card_number LIKE ? OR holder_name LIKE ?
                 ORDER BY holder_name ASC, card_number ASC
                 LIMIT ${limit}`,
                [like, like],
            )
            : await pool.execute(
                `SELECT id, card_number, holder_name, balance, status
                 FROM tarjetas
                 WHERE negocio_id = ? AND (card_number LIKE ? OR holder_name LIKE ?)
                 ORDER BY holder_name ASC, card_number ASC
                 LIMIT ${limit}`,
                [scopeNegocioId, like, like],
            );
        res.json(rows);
    } catch (error) {
        console.error('Error en /cards/search:', error);
        res.status(500).json({ error: 'Error al buscar tarjetas' });
    }
});

// POST /api/cards/recharge — body: { card_id, monto, referencia? }
async function handleRecharge(req, res) {
    const role = String(req.user?.rol || '').toLowerCase();
    const allowed = ['admin', 'superadmin', 'cajero'];
    if (!allowed.includes(role)) {
        return res.status(403).json({ error: 'No tienes permisos para recargar saldo' });
    }

    const cardId = String(req.body?.card_id ?? req.params.id ?? '').trim();
    const amount = roundMoney(Number(req.body?.monto ?? req.body?.amount ?? 0));
    const referencia = String(req.body?.referencia || '').trim() || null;

    if (!cardId) return res.status(400).json({ error: 'card_id requerido' });
    if (!(amount > 0)) return res.status(400).json({ error: 'monto inválido' });

    const scopeNegocioId = resolveScopeNegocioId(req);

    const [rows] = !scopeNegocioId
        ? await pool.execute(
            'SELECT id, negocio_id, status, balance, card_number FROM tarjetas WHERE id = ? LIMIT 1',
            [cardId],
        )
        : await pool.execute(
            'SELECT id, negocio_id, status, balance, card_number FROM tarjetas WHERE id = ? AND negocio_id = ? LIMIT 1',
            [cardId, scopeNegocioId],
        );

    if (!rows.length) return res.status(404).json({ error: 'Tarjeta no encontrada' });
    const card = rows[0];
    if (String(card.status || '').toLowerCase() !== 'active') {
        return res.status(400).json({ error: 'Tarjeta inactiva' });
    }

    const negocioId = scopeNegocioId || card.negocio_id;
    const txId = uuidv4();
    const pagoId = uuidv4();

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        await connection.execute(
            `INSERT INTO transacciones (id, negocio_id, type, amount, card_id, card_number, description, status)
             VALUES (?, ?, 'recharge', ?, ?, ?, ?, 'completed')`,
            [txId, negocioId, amount, cardId, card.card_number, 'Recarga POS'],
        );

        if (scopeNegocioId) {
            await connection.execute(
                'UPDATE tarjetas SET balance = balance + ? WHERE id = ? AND negocio_id = ?',
                [amount, cardId, scopeNegocioId],
            );
        } else {
            await connection.execute('UPDATE tarjetas SET balance = balance + ? WHERE id = ?', [amount, cardId]);
        }

        await insertPagoRecarga(connection, {
            pagoId,
            negocioId,
            transactionId: txId,
            monto: amount,
            referencia,
            cardId,
        });

        await connection.commit();

        const [updated] = !scopeNegocioId
            ? await pool.execute('SELECT *, created_at as created_date FROM tarjetas WHERE id = ? LIMIT 1', [cardId])
            : await pool.execute(
                'SELECT *, created_at as created_date FROM tarjetas WHERE id = ? AND negocio_id = ? LIMIT 1',
                [cardId, scopeNegocioId],
            );

        return res.json({
            success: true,
            transaction_id: txId,
            pago_id: pagoId,
            referencia,
            tarjeta: updated[0],
        });
    } catch (error) {
        if (connection) try { await connection.rollback(); } catch {}
        console.error('Recargar tarjeta:', error);
        return res.status(500).json({
            error: 'Error al recargar saldo',
            detail: process.env.NODE_ENV === 'development' ? String(error?.message || error) : undefined,
        });
    } finally {
        if (connection) connection.release();
    }
}

function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

router.post('/recharge', handleRecharge);

// GET /api/cards/number/:cardNumber — debe ir antes de /:id
router.get('/number/:cardNumber', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const [rows] = !scopeNegocioId
            ? await pool.execute(
                'SELECT *, created_at as created_date FROM tarjetas WHERE card_number = ?',
                [req.params.cardNumber],
            )
            : await pool.execute(
                'SELECT *, created_at as created_date FROM tarjetas WHERE card_number = ? AND negocio_id = ?',
                [req.params.cardNumber, scopeNegocioId],
            );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Tarjeta no encontrada' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Error al obtener tarjeta:', error);
        res.status(500).json({ error: 'Error al obtener tarjeta' });
    }
});

// GET /api/cards/:id/movements
router.get('/:id/movements', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const cardId = String(req.params.id || '').trim();

        const [exists] = !scopeNegocioId
            ? await pool.execute('SELECT id FROM tarjetas WHERE id = ? LIMIT 1', [cardId])
            : await pool.execute('SELECT id FROM tarjetas WHERE id = ? AND negocio_id = ? LIMIT 1', [cardId, scopeNegocioId]);
        if (!exists.length) {
            return res.status(404).json({ error: 'Tarjeta no encontrada' });
        }

        let rows;
        try {
            const sql = scopeNegocioId
                ? `SELECT p.id, p.tipo, p.metodo, p.monto, p.referencia, p.created_at, p.transaction_id,
                          p.estado, t.type AS tx_type, t.description AS tx_description
                    FROM pagos p
                    INNER JOIN transacciones t ON t.id = p.transaction_id
                    WHERE p.card_id = ? AND t.negocio_id = ?
                    ORDER BY p.created_at DESC
                    LIMIT 50`
                : `SELECT p.id, p.tipo, p.metodo, p.monto, p.referencia, p.created_at, p.transaction_id,
                          p.estado, t.type AS tx_type, t.description AS tx_description
                    FROM pagos p
                    INNER JOIN transacciones t ON t.id = p.transaction_id
                    WHERE p.card_id = ?
                    ORDER BY p.created_at DESC
                    LIMIT 50`;
            const params = scopeNegocioId ? [cardId, scopeNegocioId] : [cardId];
            [rows] = await pool.execute(sql, params);
        } catch (err) {
            if (!isBadFieldError(err)) throw err;
            const sql = scopeNegocioId
                ? `SELECT p.id, p.tipo, p.metodo, p.monto, p.referencia, p.created_at, p.transaction_id,
                          t.type AS tx_type, t.description AS tx_description
                    FROM pagos p
                    INNER JOIN transacciones t ON t.id = p.transaction_id
                    WHERE p.card_id = ? AND t.negocio_id = ?
                    ORDER BY p.created_at DESC
                    LIMIT 50`
                : `SELECT p.id, p.tipo, p.metodo, p.monto, p.referencia, p.created_at, p.transaction_id,
                          t.type AS tx_type, t.description AS tx_description
                    FROM pagos p
                    INNER JOIN transacciones t ON t.id = p.transaction_id
                    WHERE p.card_id = ?
                    ORDER BY p.created_at DESC
                    LIMIT 50`;
            const params = scopeNegocioId ? [cardId, scopeNegocioId] : [cardId];
            [rows] = await pool.execute(sql, params);
            rows = rows.map((r) => ({ ...r, estado: 'aprobado' }));
        }

        res.json({ movements: rows });
    } catch (error) {
        console.error('Error en /cards/:id/movements:', error);
        res.status(500).json({ error: 'Error al obtener movimientos' });
    }
});

// GET /api/cards/:id
router.get('/:id', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const [rows] = !scopeNegocioId
            ? await pool.execute(
                'SELECT *, created_at as created_date FROM tarjetas WHERE id = ?',
                [req.params.id],
            )
            : await pool.execute(
                'SELECT *, created_at as created_date FROM tarjetas WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopeNegocioId],
            );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Tarjeta no encontrada' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Error al obtener tarjeta:', error);
        res.status(500).json({ error: 'Error al obtener tarjeta' });
    }
});

// POST /api/cards — crear
router.post('/', async (req, res) => {
    try {
        const role = String(req.user?.rol || '').toLowerCase();
        const negocioId = role === 'cajero' || role === 'mesero'
            ? String(req.user?.negocio_id || '').trim()
            : String(req.body?.negocio_id || req.headers['x-negocio-id'] || req.user?.negocio_id || '').trim();
        if (!negocioId) return res.status(403).json({ error: 'Usuario sin negocio asignado' });
        const {
            card_number,
            holder_name,
            holder_phone,
            balance = 0,
            status = 'active',
        } = req.body;

        if (!card_number || !holder_name) {
            return res.status(400).json({ error: 'card_number y holder_name son requeridos' });
        }

        const id = uuidv4();
        await pool.execute(
            `INSERT INTO tarjetas (id, negocio_id, card_number, holder_name, holder_phone, balance, status)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, negocioId, card_number, holder_name, holder_phone || null, balance, status],
        );

        const [newCard] = await pool.execute(
            'SELECT *, created_at as created_date FROM tarjetas WHERE id = ? AND negocio_id = ?',
            [id, negocioId],
        );

        res.status(201).json(newCard[0]);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'El número de tarjeta ya existe' });
        }
        console.error('Error al crear tarjeta:', error);
        res.status(500).json({ error: 'Error al crear tarjeta' });
    }
});

// PUT /api/cards/:id
router.put('/:id', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const {
            card_number,
            holder_name,
            holder_phone,
            balance,
            status,
        } = req.body;

        const [existing] = !scopeNegocioId
            ? await pool.execute(
                'SELECT * FROM tarjetas WHERE id = ?',
                [req.params.id],
            )
            : await pool.execute(
                'SELECT * FROM tarjetas WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopeNegocioId],
            );

        if (existing.length === 0) {
            return res.status(404).json({ error: 'Tarjeta no encontrada' });
        }

        const updates = [];
        const values = [];

        if (card_number !== undefined) { updates.push('card_number = ?'); values.push(card_number); }
        if (holder_name !== undefined) { updates.push('holder_name = ?'); values.push(holder_name); }
        if (holder_phone !== undefined) { updates.push('holder_phone = ?'); values.push(holder_phone); }
        if (balance !== undefined) { updates.push('balance = ?'); values.push(balance); }
        if (status !== undefined) { updates.push('status = ?'); values.push(status); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
        }

        if (!scopeNegocioId) {
            values.push(req.params.id);
            await pool.execute(
                `UPDATE tarjetas SET ${updates.join(', ')} WHERE id = ?`,
                values,
            );
        } else {
            values.push(req.params.id, scopeNegocioId);
            await pool.execute(
                `UPDATE tarjetas SET ${updates.join(', ')} WHERE id = ? AND negocio_id = ?`,
                values,
            );
        }

        const [updated] = !scopeNegocioId
            ? await pool.execute(
                'SELECT *, created_at as created_date FROM tarjetas WHERE id = ?',
                [req.params.id],
            )
            : await pool.execute(
                'SELECT *, created_at as created_date FROM tarjetas WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopeNegocioId],
            );

        res.json(updated[0]);
    } catch (error) {
        console.error('Error al actualizar tarjeta:', error);
        res.status(500).json({ error: 'Error al actualizar tarjeta' });
    }
});

// DELETE /api/cards/:id
router.delete('/:id', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const [result] = !scopeNegocioId
            ? await pool.execute(
                'DELETE FROM tarjetas WHERE id = ?',
                [req.params.id],
            )
            : await pool.execute(
                'DELETE FROM tarjetas WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopeNegocioId],
            );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Tarjeta no encontrada' });
        }

        res.json({ message: 'Tarjeta eliminada correctamente' });
    } catch (error) {
        console.error('Error al eliminar tarjeta:', error);
        res.status(500).json({ error: 'Error al eliminar tarjeta' });
    }
});

// POST /api/cards/:id/recharge — alias (compat)
router.post('/:id/recharge', handleRecharge);

export default router;
