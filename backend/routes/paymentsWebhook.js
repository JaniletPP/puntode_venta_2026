import express from 'express';
import pool from '../config/database.js';
import { getPaymentById, getMercadoPagoAccessToken } from '../services/mercadoPagoPoint.js';
import { completeTransactionIfPaid } from '../lib/paymentCompletion.js';

const router = express.Router();

function parseMpPaymentId(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const id =
        payload.data?.id
        ?? payload.data?.id?.toString()
        ?? payload.id;
    if (id != null && id !== '') return String(id);
    return null;
}

/**
 * POST /api/payments/webhook  (montado sin auth, con body raw en server.js)
 */
router.post('/', async (req, res) => {
    res.status(200).json({ received: true });

    let payload;
    try {
        const raw = req.body;
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
        payload = text ? JSON.parse(text) : {};
    } catch (e) {
        console.warn('[MP webhook] JSON inválido', e.message);
        return;
    }

    const paymentId = parseMpPaymentId(payload);
    if (!paymentId) {
        console.log('[MP webhook] Sin payment id en payload', JSON.stringify(payload).slice(0, 300));
        return;
    }

    setImmediate(async () => {
        const token = getMercadoPagoAccessToken();
        if (!token) {
            console.error('[MP webhook] Sin MERCADOPAGO_ACCESS_TOKEN');
            return;
        }

        let payment;
        try {
            payment = await getPaymentById(paymentId, token);
        } catch (e) {
            console.error('[MP webhook] Error obteniendo payment', paymentId, e);
            return;
        }

        const extRef = String(payment.external_reference || '').trim();
        if (!extRef) {
            console.warn('[MP webhook] Payment sin external_reference', paymentId);
            return;
        }

        const status = String(payment.status || '').toLowerCase();
        let nuevoEstado = null;
        if (status === 'approved') nuevoEstado = 'aprobado';
        else if (status === 'rejected' || status === 'cancelled' || status === 'refunded') nuevoEstado = 'rechazado';
        else if (status === 'pending' || status === 'in_process') return;

        if (!nuevoEstado) {
            console.log('[MP webhook] Estado MP no manejado:', status, paymentId);
            return;
        }

        try {
            const [pagos] = await pool.execute(
                'SELECT id, transaction_id FROM pagos WHERE id = ? LIMIT 1',
                [extRef],
            );
            if (!pagos.length) {
                console.warn('[MP webhook] Pago interno no encontrado:', extRef);
                return;
            }
            const txId = pagos[0].transaction_id;

            await pool.execute(
                `UPDATE pagos SET referencia_externa = ?, estado = ? WHERE id = ?`,
                [paymentId, nuevoEstado, extRef],
            );

            if (nuevoEstado === 'aprobado') {
                const result = await completeTransactionIfPaid(txId);
                console.log('[MP webhook] Pago aprobado', extRef, 'tx', txId, result);
            }
        } catch (e) {
            console.error('[MP webhook] Error actualizando pago', e);
        }
    });
});

export default router;
