/**
 * Mercado Pago Point — Integration API
 * Docs: https://www.mercadopago.com/developers/en/docs/mp-point
 *
 * Requiere: MERCADOPAGO_ACCESS_TOKEN (o MERCADO_PAGO_ACCESS_TOKEN) y device_id en cada cobro o MERCADOPAGO_POINT_DEVICE_ID
 */

const MP_API = 'https://api.mercadopago.com';

export function getMercadoPagoAccessToken() {
    return (
        process.env.MERCADOPAGO_ACCESS_TOKEN
        || process.env.MERCADO_PAGO_ACCESS_TOKEN
        || ''
    ).trim();
}

/**
 * Crea intención de cobro en el Point asociado al device_id.
 * external_reference debe ser el id interno del pago (pago.id) para reconciliar webhook.
 */
export async function createPointPaymentIntent({
    accessToken,
    deviceId,
    amount,
    externalReference,
    description = 'Venta POS',
}) {
    const token = accessToken || getMercadoPagoAccessToken();
    if (!token) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN');
    if (!deviceId) throw new Error('Falta device_id del terminal Point');

    const url = `${MP_API}/point/integration-api/devices/${encodeURIComponent(deviceId)}/payment-intents`;

    const body = {
        amount: Math.round(Number(amount) * 100) / 100,
        description: String(description).slice(0, 120),
        external_reference: String(externalReference),
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg =
            data.message
            || data.error
            || data.cause?.map((c) => c.description).filter(Boolean).join('; ')
            || `Mercado Pago HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.mpBody = data;
        throw err;
    }
    return data;
}

export async function getPaymentById(paymentId, accessToken) {
    const token = accessToken || getMercadoPagoAccessToken();
    if (!token) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN');
    const res = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
}
