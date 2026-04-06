import React, { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/apiConfig';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
    TrendingUp, 
    CreditCard, 
    ShoppingBag, 
    DollarSign,
    Package,
    Users,
    ArrowUpRight,
    ArrowDownRight,
    Loader2
} from "lucide-react";
import { motion } from "framer-motion";
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function Dashboard() {
    const [transactions, setTransactions] = useState([]);
    const [products, setProducts] = useState([]);
    const [cards, setCards] = useState([]);
    const [loadingTx, setLoadingTx] = useState(true);

    // Función para cargar transacciones desde el backend
    const fetchTransactions = async () => {
        try {
            setLoadingTx(true);
            const response = await fetchApi('/transactions');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            // Ordenar por fecha de creación descendente y limitar a 100
            const sortedData = data.sort((a, b) => new Date(b.created_at || b.created_date || 0) - new Date(a.created_at || a.created_date || 0)).slice(0, 100);
            setTransactions(sortedData);
        } catch (error) {
            console.error('Error al cargar transacciones:', error);
            setTransactions([]);
        } finally {
            setLoadingTx(false);
        }
    };

    // Función para cargar productos desde el backend
    const fetchProducts = async () => {
        try {
            const response = await fetchApi('/products');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            setProducts(data);
        } catch (error) {
            console.error('Error al cargar productos:', error);
            setProducts([]);
        }
    };

    // Función para cargar tarjetas desde el backend
    const fetchCards = async () => {
        try {
            const response = await fetchApi('/cards');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            setCards(data);
        } catch (error) {
            console.error('Error al cargar tarjetas:', error);
            setCards([]);
        }
    };

    // Cargar todos los datos al montar el componente
    useEffect(() => {
        fetchTransactions();
        fetchProducts();
        fetchCards();
    }, []);

    // Calculate stats
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayTransactions = transactions.filter(t => 
        new Date(t.created_date) >= todayStart
    );
    
    const todaySales = todayTransactions
        .filter(t => t.type === 'sale')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    
    const todayRecharges = todayTransactions
        .filter(t => t.type === 'recharge')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    const totalBalance = cards.reduce((sum, c) => sum + Number(c.balance || 0), 0);
    const activeCards = cards.filter(c => c.status === 'active').length;
    const lowStockProducts = products.filter(p => Number(p.stock || 0) <= 5).length;

    // Chart data - last 7 days
    const chartData = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        date.setHours(0, 0, 0, 0);
        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);
        
        const dayTransactions = transactions.filter(t => {
            const txDate = new Date(t.created_date);
            return txDate >= date && txDate < nextDay;
        });
        
        return {
            name: format(date, 'EEE', { locale: es }),
            ventas: dayTransactions.filter(t => t.type === 'sale').reduce((s, t) => s + Number(t.amount || 0), 0),
            recargas: dayTransactions.filter(t => t.type === 'recharge').reduce((s, t) => s + Number(t.amount || 0), 0),
        };
    });

    // Transaction type distribution
    const pieData = [
        { name: 'Ventas', value: transactions.filter(t => t.type === 'sale').reduce((s, t) => s + Number(t.amount || 0), 0) },
        { name: 'Recargas', value: transactions.filter(t => t.type === 'recharge').reduce((s, t) => s + Number(t.amount || 0), 0) },
    ].filter(d => Number(d.value || 0) > 0);

    const recentTransactions = transactions.slice(0, 8);

    const typeLabels = {
        sale: 'Venta',
        recharge: 'Recarga',
        parking: 'Estacionamiento',
        refund: 'Reembolso'
    };

    const typeColors = {
        sale: 'text-green-600 bg-green-50',
        recharge: 'text-blue-600 bg-blue-50',
        parking: 'text-amber-600 bg-amber-50',
        refund: 'text-red-600 bg-red-50'
    };

    if (loadingTx) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold text-slate-800">Dashboard</h1>
                    <p className="text-slate-500 mt-1">Resumen de tu punto de venta</p>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 }}>
                        <Card className="border-0 shadow-sm bg-gradient-to-br from-green-500 to-green-600 text-white overflow-hidden">
                            <CardContent className="p-6 relative">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-green-100 text-sm">Ventas Hoy</p>
                                        <p className="text-3xl font-bold mt-1">${Number(todaySales || 0).toFixed(2)}</p>
                                    </div>
                                    <div className="bg-white/20 p-3 rounded-xl">
                                        <ShoppingBag className="w-6 h-6" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 mt-4 text-sm text-green-100">
                                    <ArrowUpRight className="w-4 h-4" />
                                    <span>{todayTransactions.filter(t => t.type === 'sale').length} transacciones</span>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                        <Card className="border-0 shadow-sm bg-gradient-to-br from-blue-500 to-blue-600 text-white overflow-hidden">
                            <CardContent className="p-6 relative">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-blue-100 text-sm">Recargas Hoy</p>
                                        <p className="text-3xl font-bold mt-1">${Number(todayRecharges || 0).toFixed(2)}</p>
                                    </div>
                                    <div className="bg-white/20 p-3 rounded-xl">
                                        <CreditCard className="w-6 h-6" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 mt-4 text-sm text-blue-100">
                                    <Users className="w-4 h-4" />
                                    <span>{activeCards} tarjetas activas</span>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>

                    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
                        <Card className="border-0 shadow-sm bg-gradient-to-br from-indigo-500 to-indigo-600 text-white overflow-hidden">
                            <CardContent className="p-6 relative">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-indigo-100 text-sm">Saldo en Tarjetas</p>
                                        <p className="text-3xl font-bold mt-1">${Number(totalBalance || 0).toFixed(2)}</p>
                                    </div>
                                    <div className="bg-white/20 p-3 rounded-xl">
                                        <DollarSign className="w-6 h-6" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 mt-4 text-sm text-indigo-100">
                                    {lowStockProducts > 0 ? (
                                        <>
                                            <ArrowDownRight className="w-4 h-4 text-red-300" />
                                            <span className="text-red-200">{lowStockProducts} productos bajo stock</span>
                                        </>
                                    ) : (
                                        <>
                                            <Package className="w-4 h-4" />
                                            <span>{products.length} productos</span>
                                        </>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                </div>

                {/* Charts */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <Card className="border-0 shadow-sm lg:col-span-2">
                        <CardHeader>
                            <CardTitle className="text-lg font-semibold text-slate-800">Ingresos - Últimos 7 días</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData}>
                                        <defs>
                                            <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3}/>
                                                <stop offset="95%" stopColor="#22c55e" stopOpacity={0}/>
                                            </linearGradient>
                                            <linearGradient id="colorRecargas" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                                        <YAxis stroke="#94a3b8" fontSize={12} />
                                        <Tooltip 
                                            contentStyle={{ 
                                                backgroundColor: 'white', 
                                                border: 'none', 
                                                borderRadius: '12px',
                                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                                            }}
                                        />
                                        <Area 
                                            type="monotone" 
                                            dataKey="ventas" 
                                            stroke="#22c55e" 
                                            fillOpacity={1} 
                                            fill="url(#colorVentas)" 
                                            strokeWidth={2}
                                            name="Ventas"
                                        />
                                        <Area 
                                            type="monotone" 
                                            dataKey="recargas" 
                                            stroke="#3b82f6" 
                                            fillOpacity={1} 
                                            fill="url(#colorRecargas)" 
                                            strokeWidth={2}
                                            name="Recargas"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-lg font-semibold text-slate-800">Distribución</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {pieData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            formatter={(value) => `$${Number(value || 0).toFixed(2)}`}
                                            contentStyle={{ 
                                                backgroundColor: 'white', 
                                                border: 'none', 
                                                borderRadius: '12px',
                                                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex flex-wrap justify-center gap-4 mt-4">
                                {pieData.map((entry, index) => (
                                    <div key={entry.name} className="flex items-center gap-2">
                                        <div 
                                            className="w-3 h-3 rounded-full" 
                                            style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                        />
                                        <span className="text-sm text-slate-600">{entry.name}</span>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Recent Transactions */}
                <Card className="border-0 shadow-sm">
                    <CardHeader>
                        <CardTitle className="text-lg font-semibold text-slate-800">Transacciones Recientes</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {recentTransactions.length === 0 ? (
                                <p className="text-center text-slate-500 py-8">No hay transacciones recientes</p>
                            ) : (
                                recentTransactions.map((tx, index) => (
                                    <motion.div
                                        key={tx.id}
                                        initial={{ opacity: 0, x: -20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: index * 0.05 }}
                                        className="flex items-center justify-between p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2 rounded-lg ${typeColors[tx.type]}`}>
                                                {tx.type === 'sale' && <ShoppingBag className="w-5 h-5" />}
                                                {tx.type === 'recharge' && <CreditCard className="w-5 h-5" />}
                                                {tx.type === 'parking' && <Package className="w-5 h-5" />}
                                                {tx.type === 'refund' && <TrendingUp className="w-5 h-5" />}
                                            </div>
                                            <div>
                                                <p className="font-medium text-slate-800">{typeLabels[tx.type]}</p>
                                                <p className="text-sm text-slate-500">
                                                    {tx.card_number ? `Tarjeta: ${tx.card_number}` : tx.description}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className={`font-bold ${tx.type === 'refund' ? 'text-red-600' : 'text-green-600'}`}>
                                                {tx.type === 'refund' ? '-' : '+'}${Number(tx.amount || 0).toFixed(2)}
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                {format(new Date(tx.created_date), 'dd/MM HH:mm', { locale: es })}
                                            </p>
                                        </div>
                                    </motion.div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}