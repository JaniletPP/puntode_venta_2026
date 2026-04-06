/**
 * Consulta de saldo para titulares de tarjeta interna (sin sesión).
 * Solo búsqueda por número exacto de tarjeta (el número actúa como identificador).
 */
import express from 'express';
import pool from '../config/database.js';
import { isBadFieldError } from '../lib/dbErrors.js';

const router = express.Router();
const MOV_LIMIT = 30;

function maskNumber(cardNumber) {
    const s = String(cardNumber || '').trim();
    if (s.length <= 4) return s ? `****${s}` : '****';
    return `****${s.slice(-4)}`;
}

function labelTipo(tipo) {
    const t = String(tipo || '').toLowerCase();
    if (t === 'tarjeta_interna') return 'Compra / pago';
    if (t === 'recarga') return 'Recarga de saldo';
    if (t === 'efectivo') return 'Efectivo';
    if (t === 'tarjeta_externa') return 'Terminal';
    return t.replace(/_/g, ' ');
}

/**
 * GET /api/public/tarjeta/consulta?numero=XXXX
 */
router.get('/consulta', async (req, res) => {
    const numero = String(req.query.numero || '').trim();
    if (numero.length < 3) {
        return res.status(400).json({ error: 'Ingresa el número completo de tu tarjeta' });
    }

    try {
        const [rows] = await pool.execute(
            'SELECT id, card_number, holder_name, balance, status FROM tarjetas WHERE card_number = ? LIMIT 1',
            [numero],
        );

        if (!rows.length) {
            return res.status(404).json({ error: 'No encontramos una tarjeta con ese número' });
        }

        const card = rows[0];
        if (String(card.status || '').toLowerCase() !== 'active') {
            return res.status(403).json({ error: 'Esta tarjeta no está disponible para consulta en línea' });
        }

        const cardId = card.id;
        let movRows = [];
        try {
            try {
                const [r] = await pool.execute(
                    `SELECT p.tipo, p.monto, p.referencia, p.created_at, p.metodo,
                            t.description AS tx_description
                     FROM pagos p
                     INNER JOIN transacciones t ON t.id = p.transaction_id
                     WHERE p.card_id = ?
                     ORDER BY p.created_at DESC
                     LIMIT ${MOV_LIMIT}`,
                    [cardId],
                );
                movRows = r;
            } catch (err) {
                if (!isBadFieldError(err)) throw err;
                const [r] = await pool.execute(
                    `SELECT p.tipo, p.monto, p.referencia, p.created_at, p.metodo
                     FROM pagos p
                     INNER JOIN transacciones t ON t.id = p.transaction_id
                     WHERE p.card_id = ?
                     ORDER BY p.created_at DESC
                     LIMIT ${MOV_LIMIT}`,
                    [cardId],
                );
                movRows = r.map((m) => ({ ...m, tx_description: null }));
            }
        } catch (err) {
            const msg = String(err?.message || err);
            if (/Table .*pagos.*doesn't exist/i.test(msg) || err?.errno === 1146) {
                movRows = [];
            } else {
                throw err;
            }
        }

        const movimientos = (movRows || []).map((m) => ({
            tipo: labelTipo(m.tipo),
            monto: Number(m.monto || 0),
            fecha: m.created_at,
            detalle: m.tx_description || m.metodo || m.referencia || null,
        }));

        return res.json({
            titular: card.holder_name,
            numero_mascara: maskNumber(card.card_number),
            saldo: Number(card.balance || 0),
            movimientos,
        });
    } catch (e) {
        console.error('public/tarjeta/consulta:', e);
        return res.status(500).json({ error: 'No se pudo completar la consulta. Intenta más tarde.' });
    }
});

export default router;
