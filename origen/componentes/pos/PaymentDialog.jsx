import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchApi } from '@/lib/apiConfig';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle, XCircle, Loader2, Plus, Wallet, X, Clock, Ban, Search, Sparkles } from "lucide-react";

const NATIVE_SELECT_CLASS =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring';

const EPS = 0.009;

const METODOS_EXTERNO = ['Mercado Pago Point', 'BBVA', 'Otro'];

function roundMoney(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

function labelMetodo(tipo) {
    if (tipo === 'tarjeta_interna') return 'Tarjeta interna';
    if (tipo === 'tarjeta_externa') return 'Tarjeta (terminal)';
    if (tipo === 'efectivo') return 'Efectivo';
    if (tipo === 'recarga') return 'Recarga';
    return String(tipo || '').replace(/_/g, ' ');
}

function maskCardNumber(num) {
    const s = String(num || '').trim();
    if (s.length <= 4) return s ? `****${s}` : '—';
    return `****${s.slice(-4)}`;
}

function iconEstado(estado) {
    const e = String(estado || '').toLowerCase();
    if (e === 'aprobado') return <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" title="Aprobado" />;
    if (e === 'pendiente') return <Clock className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" title="Pendiente" />;
    if (e === 'rechazado') return <Ban className="w-4 h-4 text-red-500 shrink-0" title="Rechazado" />;
    return null;
}

/**
 * Split payments (pago combinado):
 * - En frontend se acumulan pagos temporales (no se manda nada al backend por pago individual).
 * - Cuando el restante llega a 0, se finaliza enviando todos los pagos en 1 request a /payments/process.
 */
export default function PaymentDialog({ 
    open, 
    onClose, 
    onSuccess,
    preselectedInternalCard,
    autoChargeOnOpen = false,
    scannedExternalPayment = null,
    total, 
    cartItems = [],
    canCharge = true,
}) {
    const [processing, setProcessing] = useState(false);
    const [status, setStatus] = useState(null);
    const [resultMessage, setResultMessage] = useState('');
    const [resultData, setResultData] = useState(null);

    const closingRef = useRef(false);
    const successHandledRef = useRef(false);
    const autoAppliedRef = useRef(false);
    const autoFinalizeRef = useRef(false);
    const cartRef = useRef(cartItems);
    const totalRef = useRef(total);
    cartRef.current = cartItems;
    totalRef.current = total;

    const [draftTipo, setDraftTipo] = useState('efectivo');
    const [draftMonto, setDraftMonto] = useState('');
    const [draftMetodoPreset, setDraftMetodoPreset] = useState('Mercado Pago Point');
    const [draftMetodoOtro, setDraftMetodoOtro] = useState('');
    const [draftReferencia, setDraftReferencia] = useState('');
    const [draftError, setDraftError] = useState('');
    /** Sin Point: el cobro se marca aprobado con folio (requiere referencia). */
    const [registroManualExterno, setRegistroManualExterno] = useState(false);

    /** Pagos temporales (split payments) */
    const [pagosTemp, setPagosTemp] = useState([]);

    /** Tarjeta interna: búsqueda bajo demanda (no lista completa). */
    const [internalSearchQuery, setInternalSearchQuery] = useState('');
    const [internalSearchResults, setInternalSearchResults] = useState([]);
    const [internalSearchLoading, setInternalSearchLoading] = useState(false);
    const [showInternalDropdown, setShowInternalDropdown] = useState(false);
    const [selectedInternalCard, setSelectedInternalCard] = useState(null);

    const [rechargeOpen, setRechargeOpen] = useState(false);
    const [rechargeMonto, setRechargeMonto] = useState('');
    const [rechargeSaving, setRechargeSaving] = useState(false);
    const [rechargeError, setRechargeError] = useState('');
    const internalSearchWrapRef = useRef(null);

    const saleTotal = roundMoney(totalRef.current);
    const totalPagado = roundMoney(pagosTemp.reduce((s, p) => s + Number(p.monto || 0), 0));
    const restanteSrv = roundMoney(saleTotal - totalPagado);
    const canFinalize = restanteSrv <= EPS && pagosTemp.length > 0;

    useEffect(() => {
        if (open) {
            closingRef.current = false;
            successHandledRef.current = false;
            autoAppliedRef.current = false;
            autoFinalizeRef.current = false;
        }
    }, [open]);

    useEffect(() => {
        if (!open || !scannedExternalPayment) return;
        if (autoAppliedRef.current) return;
        if (status === 'success') return;
        if (pagosTemp.length > 0) return;
        const restante = roundMoney(restanteSrv);
        if (!(restante > 0)) return;
        autoAppliedRef.current = true;
        const metodo = String(scannedExternalPayment.metodo || 'Terminal').trim();
        const referencia = String(scannedExternalPayment.referencia || '').trim().slice(0, 180);
        setDraftTipo('tarjeta_externa');
        setDraftMetodoPreset('Otro');
        setDraftMetodoOtro(metodo);
        setDraftReferencia(referencia);
        setPagosTemp([{
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            tipo: 'tarjeta_externa',
            monto: restante,
            referencia,
            metodo,
            numero_tarjeta: '',
        }]);
        if (autoChargeOnOpen) {
            autoFinalizeRef.current = true;
        } else {
            setResultMessage(`QR externo detectado (${metodo}). Pago terminal preparado por ${restante.toFixed(2)}.`);
        }
    }, [open, scannedExternalPayment, status, pagosTemp.length, restanteSrv, autoChargeOnOpen]);

    useEffect(() => {
        if (draftTipo !== 'tarjeta_externa') setRegistroManualExterno(false);
    }, [draftTipo]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setStatus(null);
        setResultData(null);
        setResultMessage('');
        setDraftError('');
        setDraftTipo('efectivo');
        setDraftMonto('');
        setDraftMetodoPreset('Mercado Pago Point');
        setDraftMetodoOtro('');
        setDraftReferencia('');
        setRegistroManualExterno(false);
        setInternalSearchQuery('');
        setInternalSearchResults([]);
        setShowInternalDropdown(false);
        setSelectedInternalCard(null);
        setRechargeOpen(false);
        setRechargeMonto('');
        setRechargeError('');
        setPagosTemp([]);

        return () => { cancelled = true; };
    }, [open, preselectedInternalCard?.id]);

    useEffect(() => {
        if (!open || !preselectedInternalCard?.id) return;
        if (
            preselectedInternalCard.card_number != null &&
            preselectedInternalCard.balance !== undefined &&
            String(preselectedInternalCard.status || '') === 'active'
        ) {
            setSelectedInternalCard(preselectedInternalCard);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchApi(`/cards/${encodeURIComponent(preselectedInternalCard.id)}`);
                if (!res.ok || cancelled) return;
                const data = await res.json();
                if (cancelled || String(data.status || '') !== 'active') return;
                setSelectedInternalCard(data);
            } catch {
                // no-op
            }
        })();
        return () => { cancelled = true; };
    }, [open, preselectedInternalCard]);

    useEffect(() => {
        if (!open || draftTipo !== 'tarjeta_interna') {
            setShowInternalDropdown(false);
            return;
        }
        const q = internalSearchQuery.trim();
        if (q.length < 2) {
            setInternalSearchResults([]);
            setInternalSearchLoading(false);
            return;
        }
        let cancelled = false;
        setInternalSearchLoading(true);
        const t = setTimeout(async () => {
            try {
                const res = await fetchApi(`/cards/search?q=${encodeURIComponent(q)}`);
                const data = await res.json().catch(() => []);
                if (cancelled) return;
                setInternalSearchResults(Array.isArray(data) ? data : []);
                setShowInternalDropdown(true);
            } catch {
                if (!cancelled) setInternalSearchResults([]);
            } finally {
                if (!cancelled) setInternalSearchLoading(false);
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [internalSearchQuery, draftTipo, open]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            const el = internalSearchWrapRef.current;
            if (!el || el.contains(e.target)) return;
            setShowInternalDropdown(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const payMontoPreview = roundMoney(draftMonto);
    const cardBalPreview = roundMoney(selectedInternalCard?.balance ?? 0);
    const insufficientInternal =
        draftTipo === 'tarjeta_interna' &&
        !!selectedInternalCard &&
        payMontoPreview > EPS &&
        payMontoPreview - cardBalPreview > EPS;

    const openRechargeModal = useCallback(() => {
        const need = Math.max(0, roundMoney(payMontoPreview - cardBalPreview));
        setRechargeMonto(need > 0 ? String(need.toFixed(2)) : '');
        setRechargeError('');
        setRechargeOpen(true);
    }, [payMontoPreview, cardBalPreview]);

    const confirmRecharge = async () => {
        setRechargeError('');
        const m = roundMoney(rechargeMonto);
        if (!selectedInternalCard?.id) return;
        if (!(m > 0)) {
            setRechargeError('Ingresa un monto válido');
            return;
        }
        setRechargeSaving(true);
        try {
            const res = await fetchApi('/cards/recharge', {
                method: 'POST',
                body: { card_id: selectedInternalCard.id, monto: m },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success === false) {
                throw new Error(data.error || 'No se pudo recargar');
            }
            if (data.tarjeta) setSelectedInternalCard(data.tarjeta);
            setRechargeOpen(false);
            setRechargeMonto('');
            setDraftError('');
        } catch (e) {
            setRechargeError(e.message || 'Error al recargar');
        } finally {
            setRechargeSaving(false);
        }
    };

    const processCurrentPayment = async () => {
        if (!canCharge) {
            setDraftError('Tu rol no puede cobrar.');
            return;
        }
        setDraftError('');
        const monto = roundMoney(draftMonto);
        if (!monto || monto <= 0) {
            setDraftError('Ingresa un monto mayor a 0');
            return;
        }
        if (monto - restanteSrv > EPS) {
            setDraftError(`No puedes pagar más que el restante ($${restanteSrv.toFixed(2)})`);
            return;
        }

        const next = {
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            tipo: draftTipo,
            monto,
            referencia: draftReferencia.trim() || '',
            metodo: '',
            numero_tarjeta: '',
        };

        if (draftTipo === 'tarjeta_interna') {
            if (!selectedInternalCard?.id) {
                setDraftError('Busca y selecciona una tarjeta interna');
                return;
            }
            if (String(selectedInternalCard.status || '') !== 'active') {
                setDraftError('La tarjeta no está activa');
                return;
            }
            const disp = roundMoney(Number(selectedInternalCard.balance || 0));
            if (monto - disp > EPS) {
                setDraftError('Saldo insuficiente. Recarga saldo antes de cobrar.');
                return;
            }
            next.tipo = 'tarjeta_interna';
            next.numero_tarjeta = String(selectedInternalCard.card_number || '').trim();
        } else if (draftTipo === 'tarjeta_externa') {
            let detalle;
            if (draftMetodoPreset === 'Otro') {
                detalle = draftMetodoOtro.trim() || 'Terminal';
            } else {
                detalle = draftMetodoPreset;
            }
            next.tipo = 'tarjeta_externa';
            next.metodo = detalle;
            if (registroManualExterno) {
                if (!draftReferencia.trim()) {
                    setDraftError('Registro manual: ingresa folio o referencia del cobro');
                    return;
                }
            }
            // Para tarjeta externa siempre pedimos referencia (folio) para que /payments/process la acepte.
            if (!draftReferencia.trim()) {
                setDraftError('Tarjeta (terminal): ingresa folio o referencia del cobro');
                return;
            }
        } else {
            next.tipo = 'efectivo';
        }

        setPagosTemp((prev) => [...prev, next]);
        setDraftMonto('');
        setDraftReferencia('');
        setResultMessage('');
    };

    const finalizeSale = useCallback(async () => {
        if (!canFinalize) return;
        setDraftError('');
        setProcessing(true);
        try {
            const snap = cartRef.current || [];
            const itemsPayload = snap.map((item) => ({
                product_id: item.id,
                product_name: item.name,
                quantity: Number(item.quantity || 0),
                unit_price: Number(item.price || 0),
                total: Number(item.price || 0) * Number(item.quantity || 0),
            }));
            const totalVenta = roundMoney(
                snap.reduce((s, item) => s + Number(item.price || 0) * Number(item.quantity || 0), 0),
            );
            const pagosPayload = pagosTemp.map((p) => ({
                metodo_pago: p.tipo,
                monto: Number(p.monto || 0),
                referencia: p.referencia || '',
                metodo: p.metodo || '',
                numero_tarjeta: p.numero_tarjeta || '',
            }));
            const res = await fetchApi('/payments/process', {
                method: 'POST',
                body: {
                    total: totalVenta,
                    description: `Venta POS - ${itemsPayload.length} productos`,
                    items: itemsPayload,
                    pagos: pagosPayload,
                },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.success === false) {
                throw new Error(data.error || 'No se pudo finalizar la venta');
            }
            setStatus('success');
            setResultData({
                transaction_id: data.transaction_id,
                total: totalVenta,
                pagos: pagosPayload.map((pp) => ({
                    metodo_pago: pp.metodo_pago,
                    monto: pp.monto,
                    referencia: pp.referencia,
                })),
            });
            setResultMessage('Venta completada');
        } catch (e) {
            console.error(e);
            setDraftError(e.message || 'Error al finalizar');
        } finally {
            setProcessing(false);
        }
    }, [canFinalize, pagosTemp]);

    useEffect(() => {
        if (!open || !autoChargeOnOpen) return;
        if (autoAppliedRef.current) return;
        if (!selectedInternalCard?.id) return;
        if (status === 'success') return;
        const bal = roundMoney(Number(selectedInternalCard.balance || 0));
        const use = roundMoney(Math.min(restanteSrv, bal));
        if (!(use > 0)) return;

        autoAppliedRef.current = true;
        setDraftTipo('tarjeta_interna');
        setDraftMonto(String(use.toFixed(2)));
        setPagosTemp((prev) => {
            if (prev.length > 0) return prev;
            return [{
                id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
                tipo: 'tarjeta_interna',
                monto: use,
                referencia: 'Auto escaneo',
                metodo: '',
                numero_tarjeta: String(selectedInternalCard.card_number || '').trim(),
            }];
        });
        const after = roundMoney(restanteSrv - use);
        if (after <= EPS) {
            autoFinalizeRef.current = true;
        } else {
            setResultMessage(`Pago automático aplicado por ${use.toFixed(2)}. Resta ${after.toFixed(2)}.`);
        }
    }, [open, autoChargeOnOpen, selectedInternalCard, restanteSrv, status]);

    useEffect(() => {
        if (!open || !autoFinalizeRef.current) return;
        if (!canFinalize || processing || status === 'success') return;
        autoFinalizeRef.current = false;
        finalizeSale();
    }, [open, canFinalize, processing, status, finalizeSale]);

    const handleClose = useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;

        const shouldFinalize = status === 'success' && !successHandledRef.current;
        const payload = shouldFinalize ? resultData : null;
        if (shouldFinalize) successHandledRef.current = true;

        try {
            const el = document.activeElement;
            if (el && typeof el.blur === 'function') el.blur();
        } catch {}

        setTimeout(async () => {
        onClose();
            if (shouldFinalize && typeof onSuccess === 'function') {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        try {
                            onSuccess(payload);
                        } catch (e) {
                            console.error('onSuccess (pago):', e);
                        }
                    });
                });
            }
        }, 0);
    }, [status, resultData, onClose, onSuccess]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, handleClose]);

    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open]);

    const handlePrintTicket = (paper = '80') => {
        if (!resultData) return;
        const folio = resultData.transaction_id || '—';
        const totalFmt = `$${Number(resultData.total || 0).toFixed(2)}`;
        const now = new Date();
        const fecha = now.toLocaleString('es-MX');
        const ticketWidth = paper === '58' ? '58mm' : '80mm';
        const widthPx = paper === '58' ? 260 : 340;
        const w = window.open('', '_blank', `width=${widthPx},height=760`);
        if (!w) return;
        const pagosBlock = (Array.isArray(resultData.pagos) ? resultData.pagos : [])
            .map((p) => {
                const tipo = String(p.metodo_pago || '').replace(/_/g, ' ');
                const monto = `$${Number(p.monto || 0).toFixed(2)}`;
                const ref = p.referencia ? String(p.referencia).replace(/</g, '&lt;') : '';
                return `<div class="pago"><div class="line"><span class="strong">${tipo}</span><span class="strong">${monto}</span></div>${ref ? `<div class="line"><span class="muted">Ref</span><span>${ref}</span></div>` : ''}</div>`;
            })
            .join('');
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Ticket ${folio}</title>
<style>
@page { size: ${ticketWidth} auto; margin: 0; }
body{font-family:monospace;margin:0;padding:10px;width:${ticketWidth};font-size:12px}
.brand{text-align:center;font-weight:800;font-size:14px}.ticket{border:1px dashed #9ca3af;border-radius:8px;padding:8px}
.line{display:flex;justify-content:space-between;margin:2px 0}.pago{border:1px solid #e5e7eb;border-radius:6px;padding:6px;margin:4px 0;background:#f9fafb}
</style></head><body>
<div class="brand">PUNTO DE VENTA</div>
<div class="ticket">
<p>Folio: ${folio}</p><p>Fecha: ${fecha}</p><p><strong>Total: ${totalFmt}</strong></p>
${pagosBlock}
</div>
</body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    if (!open) return null;

    const showForm = status !== 'success' && status !== 'error';

    const panel = (
        <>
            <div className="absolute inset-0 bg-black/80" aria-hidden onClick={() => handleClose()} />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="payment-dialog-title"
                className="relative z-10 grid w-full max-w-lg max-h-[90vh] gap-4 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    onClick={() => handleClose()}
                    aria-label="Cerrar"
                >
                    <X className="h-4 w-4" />
                </button>
                <div className="flex flex-col space-y-1.5 pr-8">
                    <h2 id="payment-dialog-title" className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
                        <Wallet className="w-5 h-5 text-indigo-600" />
                        Cobro combinado
                    </h2>
                </div>

                {status === 'success' ? (
                    <div className="py-6 text-center animate-in fade-in duration-200">
                                <CheckCircle className="w-20 h-20 text-green-500 mx-auto" />
                        <h3 className="text-xl font-bold text-slate-800 mt-4">¡Pago completado!</h3>
                        <p className="text-slate-500 mt-2">{resultMessage}</p>
                        {resultData && (
                            <div className="mx-auto mt-4 max-w-sm rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-left text-xs text-emerald-900">
                                <p><span className="font-semibold">Folio:</span> {resultData.transaction_id || '—'}</p>
                                <p><span className="font-semibold">Total:</span> ${Number(resultData.total || 0).toFixed(2)}</p>
                            </div>
                        )}
                        <div className="mx-auto mt-3 grid max-w-sm grid-cols-2 gap-2">
                            <Button type="button" variant="outline" className="w-full" onClick={() => handlePrintTicket('58')}>Ticket 58mm</Button>
                            <Button type="button" variant="outline" className="w-full" onClick={() => handlePrintTicket('80')}>Ticket 80mm</Button>
                        </div>
                        <Button type="button" className="mt-4 w-full max-w-sm bg-indigo-600 hover:bg-indigo-700" onClick={() => handleClose()}>
                            Continuar
                            </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                            <>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm bg-slate-50 rounded-xl p-3 border border-slate-100">
                                    <div>
                                        <p className="text-slate-500">Total venta</p>
                                        <p className="font-bold text-slate-800">${saleTotal.toFixed(2)}</p>
                                    </div>
                                    <div>
                                        <p className="text-slate-500">Pagado</p>
                                        <p className="font-bold text-emerald-700">${totalPagado.toFixed(2)}</p>
                                    </div>
                                    <div>
                                        <p className="text-slate-500">Pagos</p>
                                        <p className="font-bold text-slate-800">{pagosTemp.length}</p>
                                    </div>
                                    <div>
                                        <p className="text-slate-500">Restante</p>
                                        <p className={`font-bold ${restanteSrv > EPS ? 'text-amber-600' : 'text-green-600'}`}>
                                            ${restanteSrv.toFixed(2)}
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-slate-200 p-3">
                                    <Label className="text-slate-700 font-medium">Pagos realizados</Label>
                                    {pagosTemp.length === 0 ? (
                                        <p className="text-xs text-slate-500 mt-2">Aún no hay líneas de pago.</p>
                                    ) : (
                                        <ul className="mt-2 space-y-2 max-h-40 overflow-auto">
                                            {pagosTemp.map((p) => (
                                                <li
                                                    key={p.id}
                                                    className="flex items-center justify-between gap-2 text-sm rounded-lg border border-slate-100 bg-white px-3 py-2"
                                                >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        {iconEstado('aprobado')}
                                                        <span className="truncate">
                                                            {labelMetodo(p.tipo)}
                                                            {p.metodo ? ` · ${p.metodo}` : ''}
                                                        </span>
                                                    </div>
                                                    <span className="font-semibold shrink-0">${Number(p.monto).toFixed(2)}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                {showForm && restanteSrv > EPS ? (
                                    <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                                        <Label>Agregar pago</Label>
                                        <select
                                            value={draftTipo}
                                            onChange={(e) => setDraftTipo(e.target.value)}
                                            className={NATIVE_SELECT_CLASS}
                                        >
                                            <option value="efectivo">Efectivo</option>
                                            <option value="tarjeta_externa">Tarjeta — terminal Mercado Pago Point</option>
                                            <option value="tarjeta_interna">Tarjeta interna (saldo)</option>
                                        </select>

                                        {draftTipo === 'tarjeta_externa' && (
                                            <div className="space-y-2 text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-md px-2 py-2">
                                                <p>
                                                    Con terminal Point, el cobro queda <strong>pendiente</strong> hasta que Mercado Pago confirme (webhook). No cierres la venta hasta ver el pago aprobado en la lista.
                                                </p>
                                                <label className="flex items-start gap-2 cursor-pointer text-slate-800">
                                                    <input
                                                        type="checkbox"
                                                        className="mt-0.5 rounded border-input"
                                                        checked={registroManualExterno}
                                                        onChange={(e) => setRegistroManualExterno(e.target.checked)}
                                                    />
                                                    <span>
                                                        Solo registrar en el sistema (sin enviar al Point). Debes indicar el folio o autorización del cobro.
                                                    </span>
                                                </label>
                                            </div>
                                        )}
                                        {draftTipo === 'tarjeta_interna' && (
                                            <p className="text-xs text-slate-600 bg-slate-50 border rounded-md px-2 py-2">
                                                Busca la tarjeta por número o nombre (mín. 2 caracteres). Se descuenta saldo al confirmar el pago.
                                            </p>
                                        )}

                                        {draftTipo === 'tarjeta_interna' && (
                                            <div className="space-y-2" ref={internalSearchWrapRef}>
                                                <Label className="text-xs text-slate-500">Buscar tarjeta</Label>
                                                <div className="relative">
                                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                                                    <Input
                                                        className="pl-9"
                                                        placeholder="Buscar tarjeta por número o nombre..."
                                                        value={internalSearchQuery}
                                                        onChange={(e) => {
                                                            setInternalSearchQuery(e.target.value);
                                                            setShowInternalDropdown(true);
                                                        }}
                                                        onFocus={() => internalSearchResults.length > 0 && setShowInternalDropdown(true)}
                                                        autoComplete="off"
                                                    />
                                                    {internalSearchLoading ? (
                                                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                                                        </div>
                                                    ) : null}
                                                    {showInternalDropdown && internalSearchResults.length > 0 ? (
                                                        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg text-sm">
                                                            {internalSearchResults
                                                                .filter((c) => String(c.status || '') === 'active')
                                                                .map((c) => (
                                                                <li key={c.id}>
                                                                    <button
                                                                        type="button"
                                                                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-50"
                                                                        onClick={() => {
                                                                            setSelectedInternalCard(c);
                                                                            setShowInternalDropdown(false);
                                                                            setInternalSearchQuery('');
                                                                        }}
                                                                    >
                                                                        <span className="font-medium text-slate-800">
                                                                            {maskCardNumber(c.card_number)}
                                                                        </span>
                                                                        <span className="text-xs text-slate-600">{c.holder_name}</span>
                                                                        <span className="text-xs font-semibold text-emerald-700">
                                                                            ${Number(c.balance || 0).toFixed(2)}
                                                                        </span>
                                                                    </button>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    ) : null}
                                                </div>

                                                {selectedInternalCard ? (
                                                    <div
                                                        className={`rounded-lg border px-3 py-2 text-sm ${
                                                            insufficientInternal
                                                                ? 'border-red-200 bg-red-50 text-red-900'
                                                                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                                        }`}
                                                    >
                                                        <p>
                                                            <span className="text-slate-600">Cliente:</span>{' '}
                                                            <span className="font-medium">{selectedInternalCard.holder_name}</span>
                                                        </p>
                                                        <p>
                                                            <span className="text-slate-600">Tarjeta:</span>{' '}
                                                            <span className="font-mono">{maskCardNumber(selectedInternalCard.card_number)}</span>
                                                        </p>
                                                        <p>
                                                            <span className="text-slate-600">Saldo:</span>{' '}
                                                            <span className="font-bold">
                                                                ${Number(selectedInternalCard.balance || 0).toFixed(2)}
                                                            </span>
                                                        </p>
                                                        {insufficientInternal ? (
                                                            <div className="mt-2 space-y-2 border-t border-red-200 pt-2">
                                                                <p className="font-medium text-red-800">Saldo insuficiente</p>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    className="w-full bg-amber-600 hover:bg-amber-700"
                                                                    onClick={openRechargeModal}
                                                                >
                                                                    Recargar saldo
                                                                </Button>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                            </div>
                                        )}

                                        {draftTipo === 'tarjeta_externa' && (
                                            <div className="space-y-2">
                                                <Label className="text-xs text-slate-500">Etiqueta (reportes)</Label>
                                                <select
                                                    value={draftMetodoPreset}
                                                    onChange={(e) => setDraftMetodoPreset(e.target.value)}
                                                    className={NATIVE_SELECT_CLASS}
                                                >
                                                    {METODOS_EXTERNO.map((m) => (
                                                        <option key={m} value={m}>{m}</option>
                                                    ))}
                                                </select>
                                                {draftMetodoPreset === 'Otro' && (
                                                    <Input
                                                        placeholder="Describe el método"
                                                        value={draftMetodoOtro}
                                                        onChange={(e) => setDraftMetodoOtro(e.target.value)}
                                                    />
                                                )}
                                            </div>
                                        )}

                                        {(draftTipo === 'efectivo' || draftTipo === 'tarjeta_externa') && (
                                            <Input
                                                placeholder={
                                                    draftTipo === 'efectivo'
                                                        ? 'Referencia / folio (opcional)'
                                                        : registroManualExterno
                                                            ? 'Folio o autorización (obligatorio)'
                                                            : 'Nota / folio (opcional si usas Point)'
                                                }
                                                value={draftReferencia}
                                                onChange={(e) => setDraftReferencia(e.target.value)}
                                            />
                                        )}

                                        <div className="flex gap-2 items-end">
                                            <div className="flex-1">
                                                <Label className="text-xs text-slate-500">Monto</Label>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    step="0.01"
                                                    value={draftMonto}
                                                    onChange={(e) => setDraftMonto(e.target.value)}
                                                />
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 px-3 text-xs"
                                                        onClick={() => setDraftMonto(String(restanteSrv.toFixed(2)))}
                                                    >
                                                        Pagar restante
                                                    </Button>
                                                    {draftTipo === 'tarjeta_interna' && selectedInternalCard ? (
                                                        <Button
                                                            type="button"
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 px-3 text-xs"
                                                            onClick={() => {
                                                                const bal = roundMoney(Number(selectedInternalCard.balance || 0));
                                                                const use = roundMoney(Math.min(restanteSrv, bal));
                                                                setDraftMonto(use > 0 ? String(use.toFixed(2)) : '');
                                                            }}
                                                        >
                                                            Usar saldo disponible
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                className="bg-indigo-600 hover:bg-indigo-700 shrink-0"
                                                onClick={processCurrentPayment}
                                                disabled={processing || !canCharge || insufficientInternal}
                                            >
                                                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                                                    <>
                                                        <Plus className="w-4 h-4 mr-1" />
                                                        Procesar pago
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                        {draftError && <p className="text-sm text-red-600">{draftError}</p>}
                                    </div>
                                ) : showForm && canFinalize ? (
                                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                                        <p className="font-medium">Listo para finalizar la venta.</p>
                                        <Button
                                            type="button"
                                            className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700"
                                            onClick={finalizeSale}
                                            disabled={processing}
                                        >
                                            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Finalizar venta'}
                                        </Button>
                                    </div>
                                ) : null}

                                <div className="flex gap-2 pt-2">
                                    <Button type="button" variant="outline" className="flex-1" onClick={() => handleClose()}>
                                        Cancelar venta
                                    </Button>
                                </div>
                            </>
                    </div>
                )}
            </div>

            {rechargeOpen && selectedInternalCard ? (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-900/65 backdrop-blur-[2px]"
                        aria-label="Cerrar"
                        onClick={() => !rechargeSaving && setRechargeOpen(false)}
                    />
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="recharge-modal-title"
                        className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-800 px-5 py-4 text-white">
                            <div className="flex items-start gap-3">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                                    <Sparkles className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 id="recharge-modal-title" className="text-lg font-bold leading-tight">
                                        Recargar saldo
                                    </h3>
                                    <p className="mt-1 text-sm text-indigo-100">
                                        Abono registrado en sistema y sumado al saldo de la tarjeta.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4 p-5">
                            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Titular</p>
                                <p className="font-semibold text-slate-900">{selectedInternalCard.holder_name}</p>
                                <p className="mt-2 font-mono text-slate-700">{maskCardNumber(selectedInternalCard.card_number)}</p>
                                <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100">
                                    <span className="text-slate-600">Saldo actual</span>
                                    <span className="text-lg font-bold tabular-nums text-emerald-700">
                                        ${Number(selectedInternalCard.balance || 0).toFixed(2)}
                                    </span>
                                </div>
                            </div>
                            <div>
                                <Label className="text-slate-700">Monto a recargar</Label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={rechargeMonto}
                                    onChange={(e) => setRechargeMonto(e.target.value)}
                                    disabled={rechargeSaving}
                                    className="mt-1 h-11 text-lg font-semibold tabular-nums"
                                />
                            </div>
                            {rechargeError ? (
                                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                    {rechargeError}
                                </p>
                            ) : null}
                            <div className="flex gap-3 pt-1">
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="flex-1 h-11"
                                    disabled={rechargeSaving}
                                    onClick={() => setRechargeOpen(false)}
                                >
                                    Cancelar
                                </Button>
                                <Button
                                    type="button"
                                    className="flex-1 h-11 bg-indigo-600 text-base font-semibold hover:bg-indigo-700"
                                    disabled={rechargeSaving}
                                    onClick={confirmRecharge}
                                >
                                    {rechargeSaving ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        'Confirmar recarga'
                                    )}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">{panel}</div>,
        document.body,
    );
}
