import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from './utils';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
    LayoutDashboard, 
    ShoppingCart, 
    Package, 
    CreditCard, 
    Menu,
    X,
    LogOut,
    Receipt,
    Shield,
    Building2,
} from "lucide-react";
import { appParams } from '@/lib/app-params';
import { useAuth } from '@/lib/AuthContext';
import { canAccessPage, defaultLandingPage } from '@/lib/roles';

const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, page: 'Dashboard' },
    { name: 'Corte de caja', icon: Receipt, page: 'CorteCaja' },
    { name: 'Punto de Venta', icon: ShoppingCart, page: 'POS' },
    { name: 'Productos', icon: Package, page: 'Products' },
    { name: 'Tarjetas', icon: CreditCard, page: 'Cards' },
    { name: 'Usuarios', icon: Shield, page: 'Usuarios' },
    { name: 'Negocios', icon: Building2, page: 'Negocios' },
];

export default function Layout({ children, currentPageName }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const {
        hasRole,
        user,
        logout,
        selectedBusinessId,
        setBusinessScope,
        negocios,
        fetchNegocios,
    } = useAuth();
    const navigate = useNavigate();
    const isGlobalAdmin = hasRole(['superadmin']);
    const userRole = String(user?.rol ?? user?.role ?? '').toLowerCase();

    const visibleNav = navItems.filter((item) => canAccessPage(item.page, hasRole));
    const selectedBusinessLabel =
        !selectedBusinessId || selectedBusinessId === 'all'
            ? 'Todos los negocios'
            : (negocios.find((n) => n.id === selectedBusinessId)?.nombre || selectedBusinessId);
    const currentBusinessLabel = user?.negocio_nombre || user?.negocio_id || 'Sin negocio';
    const currentRoleLabel = userRole ? `${userRole.charAt(0).toUpperCase()}${userRole.slice(1)}` : 'Sin rol';

    useEffect(() => {
        if (!user) return;
        if (!canAccessPage(currentPageName, hasRole)) {
            navigate(createPageUrl(defaultLandingPage(hasRole)), { replace: true });
        }
    }, [currentPageName, user, hasRole, navigate]);

    useEffect(() => {
        let cancelled = false;
        if (!isGlobalAdmin) return undefined;
        (async () => {
            try {
                const data = await fetchNegocios();
                if (!cancelled && (!Array.isArray(data) || data.length === 0)) {
                    // no-op; contexto ya maneja lista vacía
                }
            } catch {
                // no-op
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isGlobalAdmin, fetchNegocios]);

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Mobile Header */}
            <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-slate-200 z-50 flex items-center justify-between px-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsSidebarOpen(true)}
                >
                    <Menu className="w-6 h-6" />
                </Button>
                <h1 className="font-bold text-slate-800">Sistema</h1>
                <div className="w-10" />
            </div>

            {/* Sidebar Overlay — sin framer-motion (evita conflictos DOM / insertBefore con el contenido) */}
            {isSidebarOpen && (
                <div
                    className="lg:hidden fixed inset-0 bg-black/50 z-50"
                    onClick={() => setIsSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Sidebar */}
            <aside className={`
                fixed top-0 left-0 h-full w-64 bg-white border-r border-slate-200 z-50
                transform transition-transform duration-300 ease-in-out
                lg:translate-x-0
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}>
                <div className="p-6 border-b border-slate-200">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center">
                                <ShoppingCart className="w-5 h-5 text-white" />
                            </div>
                            <div>
                                <h1 className="font-bold text-slate-800">Sistema</h1>
                                <p className="text-xs text-slate-500">Punto de Venta</p>
                            </div>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden"
                            onClick={() => setIsSidebarOpen(false)}
                        >
                            <X className="w-5 h-5" />
                        </Button>
                    </div>
                </div>

                {isGlobalAdmin ? (
                    <div className="px-4 pt-3">
                        <p className="text-xs text-slate-500 mb-1">Negocio activo</p>
                        <Select
                            value={selectedBusinessId || 'all'}
                            onValueChange={(v) => setBusinessScope(v)}
                        >
                            <SelectTrigger className="h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                {negocios.map((n) => (
                                    <SelectItem key={n.id} value={n.id}>
                                        {n.nombre}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}

                <nav className="p-4 space-y-1">
                    {visibleNav.map((item) => {
                        const isActive = currentPageName === item.page;
                        const Icon = item.icon;
                        
                        return (
                            <Link
                                key={item.page}
                                to={createPageUrl(item.page)}
                                onClick={() => setIsSidebarOpen(false)}
                            >
                                <div className={`
                                    flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200
                                    ${isActive 
                                        ? 'bg-indigo-50 text-indigo-600' 
                                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                                    }
                                `}>
                                    <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-600' : ''}`} />
                                    <span className="font-medium">{item.name}</span>
                                </div>
                            </Link>
                        );
                    })}
                </nav>

                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-200">
                    <Button
                        variant="ghost"
                        className="w-full justify-start text-slate-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => {
                            if (!appParams.appId) {
                                logout(true);
                                return;
                            }
                            base44.auth.logout();
                        }}
                    >
                        <LogOut className="w-5 h-5 mr-3" />
                        Cerrar Sesión
                    </Button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="lg:pl-64 pt-16 lg:pt-0 min-h-screen">
                <div className="px-4 lg:px-6 pt-4">
                    <div className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 shadow-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-100 px-3 py-1 text-sm font-medium text-sky-700">
                                <Building2 className="h-3.5 w-3.5" />
                                {isGlobalAdmin ? `Vista: ${selectedBusinessLabel}` : `Negocio: ${currentBusinessLabel}`}
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700">
                                <span aria-hidden>👤</span>
                                {currentRoleLabel}
                            </span>
                        </div>
                    </div>
                </div>
                {children}
            </main>
        </div>
    );
}