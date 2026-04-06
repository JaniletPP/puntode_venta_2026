import pool from '../config/database.js';
import { isBadFieldError } from './dbErrors.js';

const EPS = 0.02;

function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

async function sumPagosAprobados(conn, transactionId) {
    try {
        const [sumRows] = await conn.execute(
            `SELECT COALESCE(SUM(monto), 0) AS s FROM pagos WHERE transaction_id = ? AND estado = 'aprobado'`,
            [transactionId],
        );
        return roundMoney(sumRows[0]?.s);
    } catch (e) {
        if (!isBadFieldError(e)) throw e;
        const [sumRows] = await conn.execute(
            `SELECT COALESCE(SUM(monto), 0) AS s FROM pagos WHERE transaction_id = ?`,
            [transactionId],
        );
        return roundMoney(sumRows[0]?.s);
    }
}

/**
 * Si la suma de pagos aprobados cubre el total de la venta, descuenta stock y marca transacción completed.
 * Debe llamarse tras cada pago aprobado (efectivo, interna o vía webhook MP).
 */
export async function completeTransactionIfPaid(transactionId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [txRows] = await conn.execute(
            'SELECT id, amount, status, negocio_id FROM transacciones WHERE id = ? FOR UPDATE',
            [transactionId],
        );
        if (!txRows.length) {
            await conn.rollback();
            return { completed: false, reason: 'no_tx' };
        }
        const tx = txRows[0];
        if (String(tx.status) === 'completed') {
            await conn.commit();
            return { completed: true, already: true };
        }

        const paid = await sumPagosAprobados(conn, transactionId);
        const total = roundMoney(tx.amount);
        if (paid + EPS < total) {
            await conn.commit();
            return { completed: false, paid, total };
        }

        const [items] = await conn.execute(
            'SELECT product_id, quantity FROM transaccion_items WHERE transaction_id = ?',
            [transactionId],
        );
        for (const item of items) {
            if (!item.product_id) continue;
            await conn.execute(
                'UPDATE productos SET stock = GREATEST(0, stock - ?) WHERE id = ?',
                [Number(item.quantity || 0), item.product_id],
            );
        }

        await conn.execute(
            `UPDATE transacciones SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [transactionId],
        );
        await conn.commit();
        return { completed: true, paid, total };
    } catch (e) {
        await conn.rollback();
        console.error('completeTransactionIfPaid:', e);
        throw e;
    } finally {
        conn.release();
    }
}
