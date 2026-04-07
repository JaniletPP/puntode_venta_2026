import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchApi } from '@/lib/apiConfig';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
    Search, 
    ShoppingCart, 
    QrCode, 
    Trash2, 
    Package,
    Loader2
} from "lucide-react";
// Nota: se evita framer-motion/AnimatePresence aquí para no interferir
// con el desmontaje de portales (Radix Dialog) cuando se confirma un pago.
import ProductCard from "@/components/pos/ProductCard";
import CartItem from "@/components/pos/CartItem";
import QRScanner from "@/components/pos/QRScanner";
import PaymentDialog from "@/components/pos/PaymentDialog";
import CardRechargeDialog from "@/components/pos/CardRechargeDialog";
import { useAuth } from '@/lib/AuthContext';

export default function POS() {
    const { hasRole } = useAuth();
    const canCharge = hasRole(['admin', 'superadmin', 'cajero']);
    const [cart, setCart] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [showScanner, setShowScanner] = useState(false);
    const [showPayment, setShowPayment] = useState(false);
    const [showRecharge, setShowRecharge] = useState(false);
    /** Remonta el modal de cobro para evitar doble /transaction/start en React Strict Mode. */
    const [paymentModalKey, setPaymentModalKey] = useState(0);
    const [selectedCard, setSelectedCard] = useState(null);
    const [autoChargeOnOpen, setAutoChargeOnOpen] = useState(false);
    const [scannedExternalPayment, setScannedExternalPayment] = useState(null);
    const [products, setProducts] = useState([]);
    const [loadingProducts, setLoadingProducts] = useState(true);

    // Función para cargar productos desde el backend
    const fetchProducts = async () => {
        try {
            setLoadingProducts(true);
            const response = await fetchApi('/products');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            setProducts(data);
        } catch (error) {
            console.error('Error al cargar productos:', error);
            setProducts([]);
        } finally {
            setLoadingProducts(false);
        }
    };

    // Cargar datos al montar el componente
    useEffect(() => {
        fetchProducts();
    }, []);

    const categories = ['all', 'bebidas', 'alimentos', 'servicios', 'accesorios', 'otros'];

    const filteredProducts = products.filter(p => {
        const matchesSearch = p.name?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
        return matchesSearch && matchesCategory && p.active !== false;
    });

    const addToCart = (product) => {
        setCart(prev => {
            const existing = prev.find(item => item.id === product.id);
            if (existing) {
                return prev.map(item => 
                    item.id === product.id 
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                );
            }
            return [...prev, { ...product, quantity: 1 }];
        });
    };

    const addToCartRef = useRef(addToCart);
    addToCartRef.current = addToCart;

    const handleBarcodeScan = useCallback(async (code) => {
        const trimmed = String(code).trim();
        if (trimmed.length < 3) return;
        try {
            const res = await fetchApi(
                `/products?barcode=${encodeURIComponent(trimmed)}`,
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) {
                window.alert('Producto no encontrado');
                return;
            }
            const product = data[0];
            if (product.active === false) {
                window.alert('Producto inactivo');
                return;
            }
            addToCartRef.current(product);
        } catch (err) {
            console.error('Escáner de código de barras:', err);
            window.alert('Error al buscar el producto. Comprueba el backend (puerto 3001).');
        }
    }, []);

    useEffect(() => {
        let buffer = '';
        let timeout = null;

        const shouldCaptureBarcode = () => {
            if (showScanner || showPayment) return false;
            const el = document.activeElement;
            if (!el) return true;
            const tag = el.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
            if (el.isContentEditable) return false;
            return true;
        };

        const handleKeyDown = (e) => {
            if (!shouldCaptureBarcode()) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (timeout) clearTimeout(timeout);

            if (e.key === 'Enter') {
                const scanned = buffer.trim();
                buffer = '';
                if (scanned.length >= 3) {
                    e.preventDefault();
                    handleBarcodeScan(scanned);
                }
                return;
            }

            if (e.key.length === 1 && !e.repeat) {
                buffer += e.key;
            }

            timeout = setTimeout(() => {
                buffer = '';
            }, 100);
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            if (timeout) clearTimeout(timeout);
        };
    }, [showScanner, showPayment, handleBarcodeScan]);

    const updateQuantity = (id, quantity) => {
        if (quantity <= 0) {
            removeFromCart(id);
            return;
        }
        setCart(prev => prev.map(item => 
            item.id === id ? { ...item, quantity } : item
        ));
    };

    const removeFromCart = (id) => {
        setCart(prev => prev.filter(item => item.id !== id));
    };

    const clearCart = () => setCart([]);

    const total = cart.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 0)), 0);

    const handleCardFound = (card, options = {}) => {
        setSelectedCard(card);
        setAutoChargeOnOpen(Boolean(options?.autoCharge));
        setScannedExternalPayment(options?.externalPayment || null);
        setPaymentModalKey((k) => k + 1);
        setShowPayment(true);
    };

    const finalizeSuccessfulPayment = async () => {
        try {
            await fetchProducts();
        } catch (e) {
            console.warn('POS: no se pudo refrescar productos tras cobro', e);
        } finally {
            // Importante: limpiar aunque el refetch falle.
            clearCart();
            setSelectedCard(null);
            setShowPayment(false);
        }
    };

    const finalizeRecharge = async () => {
        // No hay lista de tarjetas en POS; el modal maneja su propio estado.
        setShowRecharge(false);
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="flex h-screen">
                {/* Products Section */}
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="bg-white border-b border-slate-200 p-4">
                        <div className="flex items-center gap-4">
                            <div className="relative flex-1 max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    placeholder="Buscar productos..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10 bg-slate-50 border-0"
                                />
                            </div>
                            <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
                                <TabsList className="bg-slate-100">
                                    {categories.map(cat => (
                                        <TabsTrigger 
                                            key={cat} 
                                            value={cat}
                                            className="capitalize text-xs"
                                        >
                                            {cat === 'all' ? 'Todos' : cat}
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                            <p className="hidden sm:block text-xs text-slate-400 max-w-[200px] leading-tight" title="El lector envía dígitos y Enter">
                                Escáner: apunta fuera del buscador y escanea; se agrega al carrito.
                            </p>
                        </div>
                    </div>

                    {/* Products Grid */}
                    <div className="flex-1 overflow-auto p-4">
                        {loadingProducts ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                            </div>
                        ) : filteredProducts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                <Package className="w-16 h-16 mb-4" />
                                <p>No hay productos disponibles</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                                {filteredProducts.map(product => (
                                    <ProductCard 
                                        key={product.id} 
                                        product={product} 
                                        onAdd={addToCart}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Cart Section */}
                <div className="w-96 bg-white border-l border-slate-200 flex flex-col">
                    {/* Cart Header */}
                    <div className="p-4 border-b border-slate-200">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <ShoppingCart className="w-5 h-5 text-indigo-600" />
                                <h2 className="font-semibold text-slate-800">Carrito</h2>
                                {cart.length > 0 && (
                                    <Badge className="bg-indigo-100 text-indigo-700">
                                        {cart.reduce((sum, item) => sum + item.quantity, 0)}
                                    </Badge>
                                )}
                            </div>
                            {cart.length > 0 && (
                                <Button 
                                    variant="ghost" 
                                    size="sm"
                                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                    onClick={clearCart}
                                >
                                    <Trash2 className="w-4 h-4 mr-1" />
                                    Vaciar
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Cart Items */}
                    <div className="flex-1 overflow-auto p-4 space-y-3">
                        {cart.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                                <ShoppingCart className="w-16 h-16 mb-4" />
                                <p>El carrito está vacío</p>
                                <p className="text-sm">Agrega productos para comenzar</p>
                            </div>
                        ) : (
                            cart.map(item => (
                                <CartItem
                                    key={item.id}
                                    item={item}
                                    onUpdateQuantity={updateQuantity}
                                    onRemove={removeFromCart}
                                />
                            ))
                        )}
                    </div>

                    {/* Cart Footer */}
                    {cart.length > 0 && (
                        <div className="p-4 border-t border-slate-200 space-y-4">
                            <div className="bg-slate-50 rounded-xl p-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-slate-600">Subtotal</span>
                                    <span className="font-semibold">${Number(total || 0).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between items-center mt-2 pt-2 border-t border-slate-200">
                                    <span className="text-lg font-bold text-slate-800">Total</span>
                                    <span className="text-2xl font-bold text-indigo-600">${Number(total || 0).toFixed(2)}</span>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button
                                    className="flex-1 h-14 text-lg bg-indigo-600 hover:bg-indigo-700"
                                    onClick={() => {
                                        setSelectedCard(null);
                                        setPaymentModalKey((k) => k + 1);
                                        setShowPayment(true);
                                    }}
                                    disabled={!canCharge}
                                    title={canCharge ? 'Cobrar venta' : 'Tu rol no puede cobrar'}
                                >
                                    <ShoppingCart className="w-5 h-5 mr-2" />
                                    {canCharge ? 'Cobrar' : 'Solo pedido'}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-14 px-4 shrink-0 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                                    onClick={() => setShowRecharge(true)}
                                    disabled={!canCharge}
                                    title={canCharge ? 'Recargar saldo a tarjeta interna' : 'Tu rol no puede recargar'}
                                >
                                    $
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="h-14 px-4 shrink-0 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                    onClick={() => setShowScanner(true)}
                                    title="Buscar tarjeta interna"
                                >
                                    <QrCode className="w-5 h-5" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* QR Scanner Dialog */}
            <QRScanner
                open={showScanner}
                onClose={() => setShowScanner(false)}
                onCardFound={handleCardFound}
            />

            {/* Payment Dialog */}
            <PaymentDialog
                key={paymentModalKey}
                open={showPayment}
                onClose={() => {
                    setShowPayment(false);
                    setSelectedCard(null);
                    setAutoChargeOnOpen(false);
                    setScannedExternalPayment(null);
                }}
                onSuccess={finalizeSuccessfulPayment}
                preselectedInternalCard={selectedCard}
                autoChargeOnOpen={autoChargeOnOpen}
                scannedExternalPayment={scannedExternalPayment}
                total={total}
                cartItems={cart}
                canCharge={canCharge}
            />

            <CardRechargeDialog
                open={showRecharge}
                onClose={() => setShowRecharge(false)}
                onSuccess={finalizeRecharge}
            />
        </div>
    );
}