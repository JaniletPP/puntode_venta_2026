import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { fetchApi } from '@/lib/apiConfig';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { 
    Plus, 
    Search, 
    CreditCard,
    Wallet,
    Pencil,
    Loader2,
    DollarSign,
    User,
    Phone,
    QrCode
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const statusColors = {
    active: 'bg-green-100 text-green-700',
    inactive: 'bg-slate-100 text-slate-700',
    blocked: 'bg-red-100 text-red-700'
};

const statusLabels = {
    active: 'Activa',
    inactive: 'Inactiva',
    blocked: 'Bloqueada'
};

export default function Cards() {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [createBanner, setCreateBanner] = useState('');
    const [formError, setFormError] = useState('');
    const [isRechargeOpen, setIsRechargeOpen] = useState(false);
    const [editingCard, setEditingCard] = useState(null);
    const [rechargeCard, setRechargeCard] = useState(null);
    const [rechargeAmount, setRechargeAmount] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [formData, setFormData] = useState({
        card_number: '',
        holder_name: '',
        holder_phone: '',
        balance: '0',
        status: 'active'
    });

    const queryClient = useQueryClient();
    const [cards, setCards] = useState([]);
    const [isLoading, setIsLoading] = useState(true);

    // Función para cargar tarjetas desde el backend
    const fetchCards = async () => {
        try {
            setIsLoading(true);
            const response = await fetchApi('/cards');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            // Validar que la respuesta sea un array
            if (!Array.isArray(data)) {
                console.error('La respuesta del servidor no es un array:', data);
                setCards([]);
                return;
            }
            // Ordenar por fecha de creación descendente
            const sortedData = data.sort((a, b) => new Date(b.created_at || b.created_date || 0) - new Date(a.created_at || a.created_date || 0));
            setCards(sortedData);
        } catch (error) {
            console.error('Error al cargar tarjetas:', error);
            setCards([]);
        } finally {
            setIsLoading(false);
        }
    };

    // Cargar tarjetas al montar el componente
    useEffect(() => {
        fetchCards();
    }, []);

    const createMutation = useMutation({
        mutationFn: (data) => base44.entities.Card.create(data),
        onSuccess: async () => {
            setFormError('');
            await fetchCards();
            resetForm();
            setCreateBanner('Tarjeta guardada. Puedes registrar otra sin cerrar esta ventana.');
            setTimeout(() => setCreateBanner(''), 8000);
        },
        onError: (err) => {
            setFormError(err?.message || 'No se pudo guardar la tarjeta');
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.Card.update(id, data),
        onSuccess: async () => {
            setFormError('');
            await fetchCards();
            resetForm();
            setCreateBanner('');
            setIsDialogOpen(false);
        },
        onError: (err) => {
            setFormError(err?.message || 'No se pudo actualizar');
        },
    });

    const rechargeMutation = useMutation({
        mutationFn: async ({ card, amount }) => {
            const m = Number(amount || 0);
            if (!(m > 0)) throw new Error('Monto inválido');
            const res = await fetchApi('/cards/recharge', {
                method: 'POST',
                body: { card_id: card.id, monto: m },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(typeof data.error === 'string' ? data.error : 'Error al recargar');
            }
            return data;
        },
        onSuccess: async () => {
            await fetchCards();
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            setRechargeCard(null);
            setRechargeAmount('');
            setIsRechargeOpen(false);
        },
    });

    const resetForm = () => {
        setFormData({
            card_number: '',
            holder_name: '',
            holder_phone: '',
            balance: '0',
            status: 'active'
        });
        setEditingCard(null);
    };

    const generateCardNumber = () => {
        const number = Math.random().toString().slice(2, 18).match(/.{1,4}/g).join('-');
        setFormData(prev => ({ ...prev, card_number: number }));
    };

    const handleEdit = (card) => {
        setEditingCard(card);
        setFormData({
            card_number: card.card_number || '',
            holder_name: card.holder_name || '',
            holder_phone: card.holder_phone || '',
            balance: card.balance?.toString() || '0',
            status: card.status || 'active'
        });
        setIsDialogOpen(true);
    };

    const handleRecharge = (card) => {
        setRechargeCard(card);
        setIsRechargeOpen(true);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        setFormError('');
        const data = {
            ...formData,
            balance: parseFloat(formData.balance) || 0
        };

        if (editingCard) {
            updateMutation.mutate({ id: editingCard.id, data });
        } else {
            createMutation.mutate(data);
        }
    };

    const handleRechargeSubmit = (e) => {
        e.preventDefault();
        const amount = parseFloat(rechargeAmount);
        if (amount > 0 && rechargeCard) {
            rechargeMutation.mutate({ card: rechargeCard, amount });
        }
    };

    // Validar que cards sea un array antes de usar filter
    const filteredCards = Array.isArray(cards) ? cards.filter(c => 
        c?.card_number?.includes(searchTerm) ||
        c?.holder_name?.toLowerCase().includes(searchTerm.toLowerCase())
    ) : [];

    // Validar que cards sea un array antes de usar reduce
    const totalBalance = Array.isArray(cards) ? cards.reduce((sum, card) => sum + Number(card?.balance || 0), 0) : 0;

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800">Tarjetas</h1>
                        <p className="text-slate-500 mt-1">Administra las tarjetas de tus clientes</p>
                    </div>
                    
                    <Dialog open={isDialogOpen} onOpenChange={(open) => {
                        setIsDialogOpen(open);
                        if (!open) {
                            resetForm();
                            setCreateBanner('');
                        }
                    }}>
                        <DialogTrigger asChild>
                            <Button className="bg-indigo-600 hover:bg-indigo-700">
                                <Plus className="w-4 h-4 mr-2" />
                                Nueva Tarjeta
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md overflow-hidden border-0 p-0 gap-0">
                            <div className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 px-6 py-5 text-white">
                                <DialogHeader className="space-y-1">
                                    <DialogTitle className="text-xl text-white">
                                        {editingCard ? 'Editar tarjeta' : 'Nueva tarjeta interna'}
                                    </DialogTitle>
                                    <p className="text-sm font-normal text-indigo-100">
                                        {editingCard
                                            ? 'Actualiza los datos del titular o el estado.'
                                            : 'Los datos se guardan en el servidor al pulsar Crear.'}
                                    </p>
                                </DialogHeader>
                            </div>
                            <div className="px-6 py-5">
                            {createBanner && !editingCard ? (
                                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                                    {createBanner}
                                </div>
                            ) : null}
                            {formError ? (
                                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 whitespace-pre-wrap">
                                    {formError}
                                </div>
                            ) : null}
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <Label>Número de Tarjeta</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            value={formData.card_number}
                                            onChange={(e) => setFormData({...formData, card_number: e.target.value})}
                                            placeholder="0000-0000-0000-0000"
                                            required
                                            className="flex-1"
                                        />
                                        <Button type="button" variant="outline" onClick={generateCardNumber}>
                                            <QrCode className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div>
                                    <Label>Nombre del Titular</Label>
                                    <Input
                                        value={formData.holder_name}
                                        onChange={(e) => setFormData({...formData, holder_name: e.target.value})}
                                        placeholder="Nombre completo"
                                        required
                                    />
                                </div>
                                <div>
                                    <Label>Teléfono</Label>
                                    <Input
                                        value={formData.holder_phone}
                                        onChange={(e) => setFormData({...formData, holder_phone: e.target.value})}
                                        placeholder="Opcional"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label>Saldo Inicial</Label>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            value={formData.balance}
                                            onChange={(e) => setFormData({...formData, balance: e.target.value})}
                                            placeholder="0.00"
                                        />
                                    </div>
                                    <div>
                                        <Label>Estado</Label>
                                        <Select 
                                            value={formData.status} 
                                            onValueChange={(value) => setFormData({...formData, status: value})}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="active">Activa</SelectItem>
                                                <SelectItem value="inactive">Inactiva</SelectItem>
                                                <SelectItem value="blocked">Bloqueada</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="flex gap-3 pt-4">
                                    <Button 
                                        type="button" 
                                        variant="outline" 
                                        className="flex-1"
                                        onClick={() => setIsDialogOpen(false)}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button 
                                        type="submit" 
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                                        disabled={createMutation.isPending || updateMutation.isPending}
                                    >
                                        {(createMutation.isPending || updateMutation.isPending) && (
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        )}
                                        {editingCard ? 'Guardar cambios' : 'Guardar tarjeta'}
                                    </Button>
                                </div>
                            </form>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Card className="border-0 shadow-sm bg-gradient-to-br from-indigo-500 to-indigo-600 text-white">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-indigo-100 text-sm">Total Tarjetas</p>
                                    <p className="text-3xl font-bold mt-1">{Array.isArray(cards) ? cards.length : 0}</p>
                                </div>
                                <CreditCard className="w-10 h-10 opacity-50" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-sm bg-gradient-to-br from-green-500 to-green-600 text-white">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-green-100 text-sm">Saldo Total</p>
                                    <p className="text-3xl font-bold mt-1">${Number(totalBalance || 0).toFixed(2)}</p>
                                </div>
                                <Wallet className="w-10 h-10 opacity-50" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-sm bg-gradient-to-br from-amber-500 to-amber-600 text-white">
                        <CardContent className="p-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-amber-100 text-sm">Tarjetas Activas</p>
                                    <p className="text-3xl font-bold mt-1">
                                        {Array.isArray(cards) ? cards.filter(c => c?.status === 'active').length : 0}
                                    </p>
                                </div>
                                <CreditCard className="w-10 h-10 opacity-50" />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Search */}
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder="Buscar por número o nombre..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 bg-slate-50 border-0"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Cards Grid */}
                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                    </div>
                ) : filteredCards.length === 0 ? (
                    <Card className="border-0 shadow-sm">
                        <CardContent className="py-12 text-center">
                            <CreditCard className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                            <p className="text-lg text-slate-500">No hay tarjetas registradas</p>
                            <p className="text-sm text-slate-400">Crea una nueva tarjeta para comenzar</p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <AnimatePresence>
                            {Array.isArray(filteredCards) && filteredCards.length > 0 ? filteredCards.map((card) => (
                                <motion.div
                                    key={card.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -20 }}
                                >
                                    <Card className="border-0 shadow-sm overflow-hidden group hover:shadow-lg transition-all duration-300">
                                        <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 text-white">
                                            <div className="flex items-center justify-between mb-6">
                                                <CreditCard className="w-8 h-8" />
                                                <Badge className={statusColors[card.status]}>
                                                    {statusLabels[card.status]}
                                                </Badge>
                                            </div>
                                            <p className="font-mono text-xl tracking-wider">{card.card_number}</p>
                                            <div className="mt-4 flex items-center gap-2 text-slate-300">
                                                <User className="w-4 h-4" />
                                                <span className="text-sm">{card.holder_name}</span>
                                            </div>
                                            {card.holder_phone && (
                                                <div className="mt-1 flex items-center gap-2 text-slate-400">
                                                    <Phone className="w-3 h-3" />
                                                    <span className="text-xs">{card.holder_phone}</span>
                                                </div>
                                            )}
                                        </div>
                                        <CardContent className="p-4">
                                            <div className="flex items-center justify-between">
                                                <div>
                                                    <p className="text-xs text-slate-500">Saldo disponible</p>
                                                    <p className="text-2xl font-bold text-indigo-600">
                                                        ${Number(card?.balance || 0).toFixed(2)}
                                                    </p>
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="w-9 h-9"
                                                        onClick={() => handleEdit(card)}
                                                    >
                                                        <Pencil className="w-4 h-4 text-slate-500" />
                                                    </Button>
                                                    <Button
                                                        size="icon"
                                                        className="w-9 h-9 bg-green-600 hover:bg-green-700"
                                                        onClick={() => handleRecharge(card)}
                                                    >
                                                        <DollarSign className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )) : null}
                        </AnimatePresence>
                    </div>
                )}

                {/* Recharge Dialog */}
                <Dialog open={isRechargeOpen} onOpenChange={setIsRechargeOpen}>
                    <DialogContent className="sm:max-w-md overflow-hidden border-0 p-0 gap-0">
                        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 px-6 py-5 text-white">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2 text-xl text-white">
                                    <Wallet className="h-6 w-6 opacity-90" />
                                    Recargar saldo
                                </DialogTitle>
                                <p className="text-sm font-normal text-emerald-100">
                                    El abono queda registrado y suma al saldo disponible.
                                </p>
                            </DialogHeader>
                        </div>
                        {rechargeCard && (
                            <form onSubmit={handleRechargeSubmit} className="space-y-4 px-6 py-5">
                                <div className="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
                                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Tarjeta</p>
                                    <p className="font-mono text-lg font-semibold tracking-wide text-slate-900">
                                        {rechargeCard.card_number}
                                    </p>
                                    <p className="mt-1 text-sm text-slate-600">{rechargeCard.holder_name}</p>
                                    <div className="mt-4 flex items-end justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-100">
                                        <div>
                                            <p className="text-xs text-slate-500">Saldo actual</p>
                                            <p className="text-2xl font-bold text-indigo-600">
                                                ${Number(rechargeCard?.balance || 0).toFixed(2)}
                                            </p>
                                        </div>
                                        <DollarSign className="h-8 w-8 text-indigo-200" />
                                    </div>
                                </div>
                                <div>
                                    <Label className="text-slate-700">Monto a recargar</Label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        value={rechargeAmount}
                                        onChange={(e) => setRechargeAmount(e.target.value)}
                                        placeholder="0.00"
                                        required
                                        className="mt-1 h-12 text-xl font-semibold tabular-nums"
                                    />
                                </div>
                                {rechargeAmount && Number(rechargeAmount || 0) > 0 && (
                                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 p-4 text-center">
                                        <p className="text-xs font-medium text-emerald-800">Saldo después de recargar</p>
                                        <p className="text-2xl font-bold tabular-nums text-emerald-700">
                                            ${(Number(rechargeCard.balance || 0) + Number(rechargeAmount || 0)).toFixed(2)}
                                        </p>
                                    </div>
                                )}
                                <div className="flex gap-3 pt-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        className="flex-1"
                                        onClick={() => setIsRechargeOpen(false)}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button
                                        type="submit"
                                        className="flex-1 bg-emerald-600 text-base font-semibold hover:bg-emerald-700"
                                        disabled={rechargeMutation.isPending}
                                    >
                                        {rechargeMutation.isPending && (
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        )}
                                        Confirmar recarga
                                    </Button>
                                </div>
                            </form>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}