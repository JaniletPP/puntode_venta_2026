import React, { useState } from 'react';
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

    const handleSearch = async () => {
        const trimmed = String(cardNumber).trim();
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
            onCardFound(data);
            setCardNumber('');
            setError('');
            onClose();
        } catch {
            setError('Error al buscar. Verifica la conexión.');
        } finally {
            setLoading(false);
        }
    };

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
                    <motion.div
                        className="aspect-square max-w-[200px] mx-auto bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl flex items-center justify-center relative overflow-hidden"
                        animate={{
                            boxShadow: ['0 0 0 0 rgba(99, 102, 241, 0)', '0 0 0 20px rgba(99, 102, 241, 0.1)', '0 0 0 0 rgba(99, 102, 241, 0)'],
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                    >
                        <QrCode className="w-16 h-16 text-slate-400" />
                        <motion.div
                            className="absolute left-0 right-0 h-1 bg-indigo-500/50"
                            animate={{ top: ['10%', '90%', '10%'] }}
                            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                        />
                    </motion.div>

                    <div className="text-center text-sm text-slate-500">
                        Escanea el código QR de la tarjeta o ingresa el número manualmente
                    </div>

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
                                onKeyDown={(e) => e.key === 'Enter' && !loading && handleSearch()}
                                disabled={loading}
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
