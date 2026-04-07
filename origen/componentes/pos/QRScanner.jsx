import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCode, CreditCard, Search } from "lucide-react";
import { motion } from "framer-motion";
import { fetchApi } from '@/lib/apiConfig';

export default function QRScanner({ open, onClose, onCardFound }) {
    const [cardNumber, setCardNumber] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [cameraReady, setCameraReady] = useState(false);
    const [cameraError, setCameraError] = useState('');
    const [scanHint, setScanHint] = useState('');
    const [scanning, setScanning] = useState(false);
    const [autoChargeOnScan, setAutoChargeOnScan] = useState(() => {
        try {
            return localStorage.getItem('pv_auto_charge_scan') === '1';
        } catch {
            return false;
        }
    });

    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const detectorRef = useRef(null);
    const rafRef = useRef(null);
    const scanLockRef = useRef(false);
    const lastScanRef = useRef({ value: '', at: 0 });

    function parseScannedPayload(rawValue) {
        const raw = String(rawValue || '').trim();
        if (!raw) return { cardNumber: '', methodHint: '', externalPayment: null };

        // 1) JSON payload: {"card_number":"123","method":"bbva"}
        if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('%7B') && raw.endsWith('%7D'))) {
            try {
                const decoded = raw.startsWith('%7B') ? decodeURIComponent(raw) : raw;
                const obj = JSON.parse(decoded);
                const card = String(obj.card_number || obj.numero || obj.card || '').trim();
                const method = String(obj.method || obj.metodo || obj.bank || '').trim();
                return { cardNumber: card, methodHint: method, externalPayment: null };
            } catch {
                // continue
            }
        }

        // 2) Prefixed payload: MP:12345678 | BBVA|12345678
        const pref = raw.match(/^([a-zA-Z_]+)\s*[:|]\s*([a-zA-Z0-9\-_.]+)$/);
        if (pref) {
            return { cardNumber: String(pref[2] || '').trim(), methodHint: String(pref[1] || '').trim(), externalPayment: null };
        }

        // 3) Query-like payload: card=12345678&method=bbva
        if (raw.includes('card=') || raw.includes('numero=')) {
            try {
                const url = new URL(raw.includes('://') ? raw : `https://local.scan/?${raw}`);
                const card = String(url.searchParams.get('card') || url.searchParams.get('numero') || '').trim();
                const method = String(url.searchParams.get('method') || url.searchParams.get('metodo') || '').trim();
                if (card) return { cardNumber: card, methodHint: method, externalPayment: null };
            } catch {
                // continue
            }
        }

        // 4) URL (con o sin esquema) en path (/card/123 o /tarjeta/123)
        const looksLikeDomainUrl =
            /^https?:\/\//i.test(raw) ||
            /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/|$)/.test(raw);
        if (looksLikeDomainUrl) {
            try {
                const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
                const url = new URL(normalized);
                const m = String(url.pathname || '').match(/(?:card|tarjeta|numero|n)\/([a-zA-Z0-9\-_.]+)/i);
                if (m?.[1]) {
                    return { cardNumber: String(m[1]).trim(), methodHint: url.hostname, externalPayment: null };
                }
                // URL de proveedor externo: usar como referencia de pago terminal
                const host = String(url.hostname || '').toLowerCase();
                let metodo = 'Terminal';
                if (host.includes('mpago') || host.includes('mercadopago')) metodo = 'Mercado Pago';
                else if (host.includes('bbva')) metodo = 'BBVA';
                else if (host) metodo = host;
                return {
                    cardNumber: '',
                    methodHint: url.hostname,
                    externalPayment: {
                        tipo: 'tarjeta_externa',
                        metodo,
                        referencia: raw.slice(0, 180),
                    },
                };
            } catch {
                // continue
            }
        }

        // 5) Raw card number
        return { cardNumber: raw, methodHint: '', externalPayment: null };
    }

    const searchByCardNumber = async (value, methodHint = '') => {
        const trimmed = String(value).trim();
        if (!trimmed) {
            setError('Ingresa el número de tarjeta');
            return;
        }
        setError('');
        setLoading(true);
        try {
            const res = await fetchApi(`/cards/number/${encodeURIComponent(trimmed)}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error || 'Tarjeta no encontrada');
                return;
            }
            if (String(data.status || '').toLowerCase() !== 'active') {
                setError('Esta tarjeta está ' + (String(data.status) === 'blocked' ? 'bloqueada' : 'inactiva'));
                return;
            }
            if (methodHint) {
                setScanHint(`Método detectado: ${methodHint}`);
            }
            onCardFound(data, { autoCharge: autoChargeOnScan, methodHint, externalPayment: null });
            setCardNumber('');
            setError('');
            onClose();
        } catch {
            setError('Error al buscar. Verifica la conexión.');
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async () => searchByCardNumber(cardNumber);

    useEffect(() => {
        if (!open) return undefined;
        if (!('mediaDevices' in navigator) || !navigator.mediaDevices?.getUserMedia) {
            setCameraError('Este dispositivo no soporta cámara en el navegador.');
            return undefined;
        }
        if (typeof window.BarcodeDetector !== 'function') {
            setCameraError('Escaneo automático no disponible aquí. Usa entrada manual.');
            return undefined;
        }

        let cancelled = false;
        const stopScan = () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop());
                streamRef.current = null;
            }
            setScanning(false);
            setCameraReady(false);
        };

        const loop = async () => {
            if (cancelled || !videoRef.current || !detectorRef.current) return;
            const now = Date.now();
            if (!scanLockRef.current) {
                try {
                    const barcodes = await detectorRef.current.detect(videoRef.current);
                    if (Array.isArray(barcodes) && barcodes.length > 0) {
                        const first = barcodes[0];
                        const raw = String(first?.rawValue || '').trim();
                        if (raw) {
                            const prev = lastScanRef.current;
                            if (prev.value !== raw || now - prev.at > 1500) {
                                lastScanRef.current = { value: raw, at: now };
                                scanLockRef.current = true;
                                const parsed = parseScannedPayload(raw);
                                if (parsed.cardNumber) {
                                    setCardNumber(parsed.cardNumber);
                                    setScanHint(parsed.methodHint ? `Método detectado: ${parsed.methodHint}` : 'Tarjeta detectada');
                                    await searchByCardNumber(parsed.cardNumber, parsed.methodHint);
                                } else if (parsed.externalPayment) {
                                    setScanHint(`QR detectado: ${parsed.methodHint || parsed.externalPayment.metodo}`);
                                    setError('');
                                    onCardFound(null, {
                                        autoCharge: autoChargeOnScan,
                                        methodHint: parsed.methodHint || '',
                                        externalPayment: parsed.externalPayment,
                                    });
                                    onClose();
                                } else if (parsed.methodHint) {
                                    setScanHint(`QR detectado: ${parsed.methodHint}`);
                                    setError('Ese QR no es de tarjeta interna del sistema. Escanea el QR/código de la tarjeta del punto de venta.');
                                }
                                setTimeout(() => { scanLockRef.current = false; }, 1200);
                            }
                        }
                    }
                } catch {
                    // no-op: continue scanning loop
                }
            }
            rafRef.current = requestAnimationFrame(loop);
        };

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: 'environment' } },
                    audio: false,
                });
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop());
                    return;
                }
                streamRef.current = stream;
                detectorRef.current = new window.BarcodeDetector({
                    formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf'],
                });
                const v = videoRef.current;
                if (!v) return;
                v.srcObject = stream;
                await v.play();
                setCameraReady(true);
                setCameraError('');
                setScanning(true);
                rafRef.current = requestAnimationFrame(loop);
            } catch (e) {
                setCameraError('No se pudo abrir la cámara. Permite acceso y vuelve a intentar.');
                setScanning(false);
            }
        })();

        return () => {
            cancelled = true;
            stopScan();
        };
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <QrCode className="w-5 h-5 text-indigo-600" />
                        Escanear Tarjeta
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    <div className="aspect-square max-w-[240px] mx-auto rounded-2xl border border-slate-200 bg-slate-100 relative overflow-hidden">
                        <video
                            ref={videoRef}
                            className={`h-full w-full object-cover ${cameraReady ? 'opacity-100' : 'opacity-0'}`}
                            playsInline
                            muted
                            autoPlay
                        />
                        {!cameraReady ? (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <QrCode className="w-16 h-16 text-slate-400" />
                            </div>
                        ) : null}
                        {cameraReady ? (
                            <motion.div
                                className="absolute left-2 right-2 h-1 bg-indigo-500/60"
                                animate={{ top: ['10%', '90%', '10%'] }}
                                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                            />
                        ) : null}
                    </div>

                    <div className="text-center text-sm text-slate-500">
                        {cameraReady
                            ? 'Apunta la cámara al QR/código de barras de la tarjeta.'
                            : 'Escanea el código QR de la tarjeta o ingresa el número manualmente'}
                    </div>
                    {cameraError ? (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                            {cameraError}
                        </p>
                    ) : null}
                    {scanHint ? (
                        <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-md px-3 py-2">
                            {scanHint}
                        </p>
                    ) : null}
                    <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                        <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={autoChargeOnScan}
                            onChange={(e) => {
                                const v = Boolean(e.target.checked);
                                setAutoChargeOnScan(v);
                                try {
                                    localStorage.setItem('pv_auto_charge_scan', v ? '1' : '0');
                                } catch {
                                    // no-op
                                }
                            }}
                        />
                        <span>
                            Cobro automático al escanear (agrega pago con saldo de tarjeta y, si cubre el total, finaliza la venta).
                        </span>
                    </label>

                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder="Número de tarjeta"
                                value={cardNumber}
                                onChange={(e) => {
                                    setCardNumber(e.target.value);
                                    setError('');
                                }}
                                className="pl-10"
                                onKeyDown={(e) => e.key === 'Enter' && !loading && searchByCardNumber(e.currentTarget.value)}
                                disabled={loading || scanning}
                            />
                        </div>
                        <Button onClick={handleSearch} className="bg-indigo-600 hover:bg-indigo-700" disabled={loading}>
                            <Search className="w-4 h-4" />
                        </Button>
                    </div>

                    {error && (
                        <motion.p
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-sm text-red-500 text-center"
                        >
                            {error}
                        </motion.p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
