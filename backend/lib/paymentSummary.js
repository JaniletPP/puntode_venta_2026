import pool from '../config/database.js';
import { isBadFieldError } from './dbErrors.js';

const EPS = 0.02;

export function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * Totales por transacción. Si falta columna `estado` (migración 005), todos los pagos cuentan como aprobados.
 */
export async function getTransactionPaymentSummary(connection, transactionId) {
    const exec = connection?.execute?.bind(connection) || pool.execute.bind(pool);
    try {
        const [rows] = await exec(
            `SELECT
                COALESCE(SUM(CASE WHEN estado = 'aprobado' THEN monto ELSE 0 END), 0) AS aprobado,
                COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN monto ELSE 0 END), 0) AS pendiente
             FROM pagos
             WHERE transaction_id = ?`,
            [transactionId],
        );
        const totalAprobado = roundMoney(rows[0]?.aprobado);
        const totalPendiente = roundMoney(rows[0]?.pendiente);
        return { totalAprobado, totalPendiente };
    } catch (err) {
        if (!isBadFieldError(err)) throw err;
        console.warn('[pagos] columna estado ausente; usar SUM(monto) como aprobado. Ejecuta migración 005.');
        const [rows] = await exec(
            `SELECT COALESCE(SUM(monto), 0) AS s FROM pagos WHERE transaction_id = ?`,
            [transactionId],
        );
        const totalAprobado = roundMoney(rows[0]?.s);
        return { totalAprobado, totalPendiente: 0 };
    }
}

export function computeRestante(totalVenta, totalAprobado, totalPendiente) {
    return roundMoney(Number(totalVenta) - totalAprobado - totalPendiente);
}

export function withinEps(a, b) {
    return Math.abs(roundMoney(a) - roundMoney(b)) <= EPS;
}
