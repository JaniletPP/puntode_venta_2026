import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { appParams } from '@/lib/app-params';
import { useAuth } from '@/lib/AuthContext';
import { fetchApi, getNetworkErrorMessage } from '@/lib/apiConfig';
import { createPageUrl } from '../utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShoppingCart, ShieldCheck, UserRound, Lock } from 'lucide-react';

function getLandingByRole(u) {
    const rol = String(u?.rol ?? u?.role ?? '').toLowerCase();
    if (rol === 'admin' || rol === 'superadmin') return createPageUrl('Dashboard');
    return createPageUrl('POS');
}

export default function Login() {
    const navigate = useNavigate();
    const { loginLocal, isAuthenticated, user } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (appParams.appId) {
            navigate(createPageUrl('POS'), { replace: true });
            return;
        }
        if (isAuthenticated && user && !user.anonymous) {
            const to = getLandingByRole(user);
            navigate(to, { replace: true });
        }
    }, [appParams.appId, isAuthenticated, user, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        const form = e.currentTarget;
        const emailEl = form.elements.namedItem('email');
        const passwordEl = form.elements.namedItem('password');
        const emailTrim = String(emailEl?.value ?? email).trim();
        const passwordVal = String(passwordEl?.value ?? password);
        try {
            const res = await fetchApi('/auth/login', {
                method: 'POST',
                body: { email: emailTrim, password: passwordVal },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const base = typeof data.error === 'string' ? data.error : 'Error al iniciar sesión';
                const detail = typeof data.detail === 'string' && data.detail.trim() ? ` — ${data.detail.trim()}` : '';
                throw new Error(`${base}${detail}`);
            }
            if (!data.token || !data.user) {
                throw new Error('Respuesta inválida del servidor');
            }
            loginLocal(data.token, data.user);
            const to = getLandingByRole(data.user);
            navigate(to, { replace: true });
        } catch (err) {
            setError(getNetworkErrorMessage(err) || err.message || 'Error al iniciar sesión');
        } finally {
            setLoading(false);
        }
    };

    if (appParams.appId) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-indigo-100 p-6">
            <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center gap-6 lg:grid-cols-2">
                <div className="hidden rounded-3xl border border-indigo-100 bg-white/70 p-8 shadow-sm backdrop-blur lg:block">
                    <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white">
                        <ShoppingCart className="h-7 w-7" />
                    </div>
                    <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-900">Sistema Punto de Venta</h1>
                    <p className="mt-2 text-slate-600">
                        Administra ventas, tarjetas y usuarios de forma segura desde un solo panel.
                    </p>
                    <div className="mt-8 space-y-3 text-sm text-slate-700">
                        <p className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1">
                            <ShieldCheck className="h-4 w-4 text-indigo-600" />
                            Acceso por roles y negocio
                        </p>
                        <p className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1">
                            <UserRound className="h-4 w-4 text-sky-600" />
                            Sesion local protegida con JWT
                        </p>
                    </div>
                </div>

                <Card className="mx-auto w-full max-w-md border-0 bg-white/95 shadow-2xl shadow-indigo-200/50">
                    <CardHeader className="space-y-2">
                        <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
                            <Lock className="h-5 w-5" />
                        </div>
                        <CardTitle className="text-2xl font-bold text-slate-900">Iniciar sesion</CardTitle>
                        <p className="text-sm text-slate-500">Acceso local (roles: admin, supervisor, cajero, mesero)</p>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="login-email">Email</Label>
                                <Input
                                    id="login-email"
                                    name="email"
                                    type="email"
                                    autoComplete="username"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="h-11 rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="login-password">Contrasena</Label>
                                <Input
                                    id="login-password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="h-11 rounded-xl border-slate-200 focus-visible:ring-indigo-500"
                                    required
                                />
                            </div>
                            {error ? (
                                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                                    {error}
                                </p>
                            ) : null}
                            <Button
                                type="submit"
                                className="h-11 w-full rounded-xl bg-indigo-600 text-sm font-semibold hover:bg-indigo-700"
                                disabled={loading}
                            >
                                {loading ? 'Entrando...' : 'Entrar al sistema'}
                            </Button>
                        </form>
                        <p className="mt-4 border-t border-slate-100 pt-4 text-center text-sm text-slate-600">
                            ¿Tienes tarjeta interna?{' '}
                            <Link
                                to="/consulta-tarjeta"
                                className="font-semibold text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline"
                            >
                                Consultar mi saldo
                            </Link>
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
