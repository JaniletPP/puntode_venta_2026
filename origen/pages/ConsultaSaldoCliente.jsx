import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchPublicApi, getNetworkErrorMessage } from '@/lib/apiConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CreditCard, LogIn } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

/**
 * Vista pública para el titular de la tarjeta interna: consulta de saldo y movimientos.
 * No requiere iniciar sesión; solo el número impreso en la tarjeta.
 */
export default function ConsultaSaldoCliente() {
    const [numero, setNumero] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [data, setData] = useState(null);

    const consultar = async (e) => {
        e?.preventDefault?.();
        setError('');
        setData(null);
        const n = String(numero).trim();
        if (n.length < 3) {
            setError('Escribe el número completo de tu tarjeta');
            return;
        }
        setLoading(true);
        try {
            const res = await fetchPublicApi(
                `/public/tarjeta/consulta?numero=${encodeURIComponent(n)}`,
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(typeof json.error === 'string' ? json.error : 'No se pudo consultar');
                return;
            }
            setData(json);
        } catch (err) {
            setError(getNetworkErrorMessage(err) || 'Error de conexión');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-slate-50">
            <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-sm">
                <div className="mx-auto flex max-w-lg items-center justify-between gap-4 px-4 py-4">
                    <div className="flex items-center gap-2 text-indigo-700">
                        <CreditCard className="h-7 w-7" />
                        <span className="font-semibold text-slate-900">Mi tarjeta</span>
                    </div>
                    <Button variant="outline" size="sm" asChild className="shrink-0 gap-1">
                        <Link to="/Login">
                            <LogIn className="h-4 w-4" />
                            Acceso personal
                        </Link>
                    </Button>
                </div>
            </header>

            <main className="mx-auto max-w-lg space-y-6 px-4 py-8">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-slate-900">Consulta tu saldo</h1>
                    <p className="mt-2 text-sm text-slate-600">
                        Ingresa el número de tu tarjeta interna para ver saldo y últimos movimientos.
                    </p>
                </div>

                <Card className="border-slate-200 shadow-md">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold text-slate-800">
                            Número de tarjeta
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={consultar} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="card-num" className="text-slate-600">
                                    Tal como aparece en tu tarjeta
                                </Label>
                                <Input
                                    id="card-num"
                                    name="numero"
                                    autoComplete="off"
                                    inputMode="numeric"
                                    placeholder="Ej. 1000123456789"
                                    value={numero}
                                    onChange={(e) => setNumero(e.target.value)}
                                    className="h-12 font-mono text-base"
                                />
                            </div>
                            {error ? (
                                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                    {error}
                                </p>
                            ) : null}
                            <Button
                                type="submit"
                                className="h-12 w-full bg-indigo-600 text-base font-semibold hover:bg-indigo-700"
                                disabled={loading}
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                        Consultando…
                                    </>
                                ) : (
                                    'Consultar'
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                {data ? (
                    <>
                        <Card className="overflow-hidden border-emerald-200 bg-gradient-to-br from-emerald-50 to-white shadow-md">
                            <CardContent className="space-y-4 p-6">
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-800/80">
                                        Titular
                                    </p>
                                    <p className="text-lg font-semibold text-slate-900">{data.titular}</p>
                                </div>
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-800/80">
                                        Tarjeta
                                    </p>
                                    <p className="font-mono text-base text-slate-800">{data.numero_mascara}</p>
                                </div>
                                <div className="rounded-xl border border-emerald-200/80 bg-white/80 px-4 py-4 text-center">
                                    <p className="text-xs text-slate-500">Saldo disponible</p>
                                    <p className="text-3xl font-bold tabular-nums text-emerald-700">
                                        ${Number(data.saldo || 0).toFixed(2)}
                                    </p>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-base">Últimos movimientos</CardTitle>
                                <p className="text-xs text-slate-500">
                                    Solo operaciones registradas con esta tarjeta
                                </p>
                            </CardHeader>
                            <CardContent>
                                {!Array.isArray(data.movimientos) || data.movimientos.length === 0 ? (
                                    <p className="py-6 text-center text-sm text-slate-500">
                                        Aún no hay movimientos que mostrar.
                                    </p>
                                ) : (
                                    <ul className="space-y-3">
                                        {data.movimientos.map((m, idx) => (
                                            <li
                                                key={`${m.fecha}-${idx}`}
                                                className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-3 text-sm"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-medium text-slate-800">{m.tipo}</p>
                                                    {m.detalle ? (
                                                        <p className="truncate text-xs text-slate-500">{m.detalle}</p>
                                                    ) : null}
                                                    <p className="mt-1 text-xs text-slate-400">
                                                        {m.fecha
                                                            ? format(new Date(m.fecha), "d MMM yyyy, HH:mm", {
                                                                  locale: es,
                                                              })
                                                            : '—'}
                                                    </p>
                                                </div>
                                                <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                                                    ${Number(m.monto || 0).toFixed(2)}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>

                        <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => {
                                setData(null);
                                setNumero('');
                                setError('');
                            }}
                        >
                            Consultar otra tarjeta
                        </Button>
                    </>
                ) : null}

                <p className="text-center text-xs text-slate-400">
                    No compartas tu número de tarjeta. Quien lo conoce puede ver esta información.
                </p>
            </main>
        </div>
    );
}
