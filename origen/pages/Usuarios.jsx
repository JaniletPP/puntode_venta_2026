import React, { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/apiConfig';
import { useAuth } from '@/lib/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Users, Loader2, ShieldCheck, UserCog, UserRound } from 'lucide-react';

const NATIVE_SELECT_CLASS =
    'flex h-9 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export default function Usuarios() {
    const [rows, setRows] = useState([]);
    const [negocios, setNegocios] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');
    const [businessFilter, setBusinessFilter] = useState('all');
    const [newUser, setNewUser] = useState({
        email: '',
        nombre: '',
        password: '',
        rol: 'cajero',
        negocio_id: '',
    });
    const { user } = useAuth();
    const currentRole = String(user?.rol ?? user?.role ?? 'cajero').toLowerCase();
    const isSuperadmin = currentRole === 'superadmin';
    const canCreateUsers = isSuperadmin || currentRole === 'admin';

    const loadData = async () => {
        const isSuper = String(user?.rol ?? user?.role ?? '').toLowerCase() === 'superadmin';
        const usuariosHeaders = isSuper ? { 'X-Negocio-Id': 'all' } : undefined;
        const reqs = [fetchApi('/usuarios', { headers: usuariosHeaders })];
        if (isSuper) reqs.push(fetchApi('/negocios'));
        const [uRes, nRes] = await Promise.all(reqs);
        const uData = await uRes.json().catch(() => []);
        if (!uRes.ok) throw new Error(typeof uData.error === 'string' ? uData.error : 'Error al cargar usuarios');
        setRows(Array.isArray(uData) ? uData : []);
        let negociosList = [];
        if (isSuper) {
            const nData = await nRes.json().catch(() => []);
            if (!nRes.ok) throw new Error(typeof nData.error === 'string' ? nData.error : 'Error al cargar negocios');
            negociosList = Array.isArray(nData) ? nData : [];
        } else {
            const ownId = String(user?.negocio_id || 'negocio_default');
            const ownName = String(user?.negocio_nombre || ownId);
            negociosList = [{ id: ownId, nombre: ownName }];
        }
        setNegocios(negociosList);
        setNewUser((prev) => ({
            ...prev,
            negocio_id: prev.negocio_id || negociosList?.[0]?.id || '',
        }));
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                await loadData();
            } catch (e) {
                if (!cancelled) {
                    setError(e.message || 'Error');
                    setRows([]);
                    setNegocios([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user?.rol, user?.role]);

    const totalUsuarios = rows.length;
    const admins = rows.filter((u) => String(u.rol || '').toLowerCase() === 'admin').length;
    const supervisores = rows.filter((u) => String(u.rol || '').toLowerCase() === 'supervisor').length;
    const cajeros = rows.filter((u) => String(u.rol || 'cajero').toLowerCase() === 'cajero').length;
    const meseros = rows.filter((u) => String(u.rol || '').toLowerCase() === 'mesero').length;
    const normalizedSearch = search.trim().toLowerCase();
    const filteredRows = rows.filter((u) => {
        const rol = String(u.rol ?? u.role ?? 'cajero').toLowerCase();
        const roleOk = roleFilter === 'all' || rol === roleFilter;
        const businessOk =
            businessFilter === 'all' ||
            String(u.negocio_id || '') === String(businessFilter) ||
            String(u.negocio_nombre || '') === String(businessFilter);
        const text = `${u.email || ''} ${u.nombre || ''} ${rol} ${u.negocio_nombre || ''} ${u.negocio_id || ''}`.toLowerCase();
        const searchOk = normalizedSearch === '' || text.includes(normalizedSearch);
        return roleOk && businessOk && searchOk;
    });

    const roleBadgeClass = (rol) => {
        const r = String(rol || 'cajero').toLowerCase();
        if (r === 'superadmin') return 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200';
        if (r === 'admin') return 'bg-violet-100 text-violet-800 border-violet-200';
        if (r === 'supervisor') return 'bg-blue-100 text-blue-800 border-blue-200';
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    };

    const refresh = async () => {
        try {
            setLoading(true);
            setError(null);
            await loadData();
        } catch (e) {
            setError(e.message || 'Error');
        } finally {
            setLoading(false);
        }
    };

    const createUser = async () => {
        if (!isSuperadmin) {
            setError('Solo superadmin puede crear usuarios');
            return;
        }
        try {
            setSaving(true);
            setError(null);
            const payload = {
                email: String(newUser.email || '').trim(),
                nombre: String(newUser.nombre || '').trim() || null,
                password: String(newUser.password || ''),
                rol: newUser.rol,
                negocio_id: newUser.negocio_id || null,
            };
            const res = await fetchApi('/usuarios', { method: 'POST', body: payload });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Error al crear usuario');
            setNewUser((prev) => ({ ...prev, email: '', nombre: '', password: '' }));
            await refresh();
        } catch (e) {
            setError(e.message || 'Error');
        } finally {
            setSaving(false);
        }
    };

    const updateUserField = async (id, patch) => {
        try {
            const res = await fetchApi(`/usuarios/${id}`, { method: 'PUT', body: patch });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error || 'Error al actualizar usuario');
            await refresh();
        } catch (e) {
            setError(e.message || 'Error');
        }
    };

    return (
        <div className="min-h-screen bg-slate-100 p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white">
                            <Users className="w-6 h-6" />
                        </span>
                        Usuarios
                    </h1>
                    <p className="text-slate-500 mt-1">Gestión y monitoreo de cuentas del sistema (solo administrador)</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-500">Total usuarios</p>
                                    <p className="text-2xl font-bold text-slate-900">{totalUsuarios}</p>
                                </div>
                                <Users className="w-8 h-8 text-violet-500" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-500">Administradores</p>
                                    <p className="text-2xl font-bold text-violet-700">{admins}</p>
                                </div>
                                <ShieldCheck className="w-8 h-8 text-violet-500" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-500">Supervisores</p>
                                    <p className="text-2xl font-bold text-blue-700">{supervisores}</p>
                                </div>
                                <UserCog className="w-8 h-8 text-blue-500" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-500">Cajeros</p>
                                    <p className="text-2xl font-bold text-emerald-700">{cajeros}</p>
                                </div>
                                <UserRound className="w-8 h-8 text-emerald-500" />
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-0 shadow-md">
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-slate-500">Meseros</p>
                                    <p className="text-2xl font-bold text-cyan-700">{meseros}</p>
                                </div>
                                <UserRound className="w-8 h-8 text-cyan-500" />
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="border-0 shadow-md">
                    <CardHeader>
                        <CardTitle className="text-lg">Cuentas registradas</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {canCreateUsers && (
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4 p-3 rounded-xl border border-slate-200 bg-slate-50">
                            <Input
                                placeholder="Email"
                                value={newUser.email}
                                onChange={(e) => setNewUser((p) => ({ ...p, email: e.target.value }))}
                            />
                            <Input
                                placeholder="Nombre"
                                value={newUser.nombre}
                                onChange={(e) => setNewUser((p) => ({ ...p, nombre: e.target.value }))}
                            />
                            <Input
                                placeholder="Contraseña"
                                type="password"
                                value={newUser.password}
                                onChange={(e) => setNewUser((p) => ({ ...p, password: e.target.value }))}
                            />
                            <select
                                className={NATIVE_SELECT_CLASS}
                                value={newUser.rol}
                                onChange={(e) => setNewUser((p) => ({ ...p, rol: e.target.value }))}
                            >
                                <option value="admin">Admin</option>
                                <option value="supervisor">Supervisor</option>
                                <option value="cajero">Cajero</option>
                                <option value="mesero">Mesero</option>
                            </select>
                            <select
                                className={NATIVE_SELECT_CLASS}
                                value={newUser.negocio_id || ''}
                                onChange={(e) => setNewUser((p) => ({ ...p, negocio_id: e.target.value }))}
                                disabled={!isSuperadmin}
                            >
                                {negocios.map((n) => (
                                    <option key={n.id} value={n.id}>{n.nombre}</option>
                                ))}
                            </select>
                            <div className="md:col-span-5">
                                <button
                                    type="button"
                                    className="inline-flex h-9 items-center justify-center rounded-md bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                                    onClick={createUser}
                                    disabled={saving}
                                >
                                    {saving ? 'Guardando...' : 'Crear usuario'}
                                </button>
                            </div>
                        </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                            <div className="md:col-span-2 space-y-1.5">
                                <Label htmlFor="usuarios-search">Buscar</Label>
                                <Input
                                    id="usuarios-search"
                                    placeholder="Buscar por email, nombre, rol o negocio..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Rol</Label>
                                <select className={NATIVE_SELECT_CLASS} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                                    <option value="all">Todos</option>
                                    <option value="superadmin">Superadmin</option>
                                    <option value="admin">Admin</option>
                                    <option value="supervisor">Supervisor</option>
                                    <option value="cajero">Cajero</option>
                                    <option value="mesero">Mesero</option>
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Negocio</Label>
                                <select className={NATIVE_SELECT_CLASS} value={businessFilter} onChange={(e) => setBusinessFilter(e.target.value)}>
                                    <option value="all">Todos</option>
                                    {negocios.map((n) => (
                                        <option key={n.id} value={n.id}>
                                            {n.nombre}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {loading ? (
                            <div className="space-y-3 py-2">
                                <div className="flex items-center gap-2 text-slate-600">
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                    Cargando usuarios...
                                </div>
                                <div className="animate-pulse space-y-2">
                                    <div className="h-10 rounded-lg bg-slate-200" />
                                    <div className="h-10 rounded-lg bg-slate-200" />
                                    <div className="h-10 rounded-lg bg-slate-200" />
                                </div>
                            </div>
                        ) : error ? (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {error}
                            </div>
                        ) : filteredRows.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
                                No hay resultados con los filtros actuales.
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-slate-50 hover:bg-slate-50">
                                            <TableHead>Email</TableHead>
                                            <TableHead>Nombre</TableHead>
                                            <TableHead>Rol</TableHead>
                                            <TableHead>Negocio</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredRows.map((u, index) => (
                                            <TableRow
                                                key={u.id}
                                                className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} hover:bg-violet-50`}
                                            >
                                                <TableCell className="font-medium text-slate-800">{u.email}</TableCell>
                                                <TableCell className="text-slate-600">{u.nombre || '—'}</TableCell>
                                                <TableCell>
                                                    {isSuperadmin ? (
                                                        <>
                                                            <select
                                                                className={NATIVE_SELECT_CLASS}
                                                                value={String(u.rol || 'cajero')}
                                                                onChange={(e) => {
                                                                    const v = e.target.value;
                                                                    if (v !== String(u.rol || 'cajero')) updateUserField(u.id, { rol: v });
                                                                }}
                                                            >
                                                                <option value="admin">Admin</option>
                                                                <option value="superadmin">Superadmin</option>
                                                                <option value="supervisor">Supervisor</option>
                                                                <option value="cajero">Cajero</option>
                                                                <option value="mesero">Mesero</option>
                                                            </select>
                                                            <div className="mt-1">
                                                                <Badge variant="outline" className={`capitalize ${roleBadgeClass(u.rol)}`}>
                                                                    {u.rol || 'cajero'}
                                                                </Badge>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <Badge variant="outline" className={`capitalize ${roleBadgeClass(u.rol)}`}>
                                                            {u.rol || 'cajero'}
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    {isSuperadmin ? (
                                                        <select
                                                            className={NATIVE_SELECT_CLASS}
                                                            value={String(u.negocio_id || '')}
                                                            onChange={(e) => {
                                                                const v = e.target.value;
                                                                if (v !== String(u.negocio_id || '')) updateUserField(u.id, { negocio_id: v });
                                                            }}
                                                        >
                                                            {negocios.map((n) => (
                                                                <option key={n.id} value={n.id}>{n.nombre}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <span className="text-slate-600">
                                                            {negocios.find((n) => n.id === u.negocio_id)?.nombre || u.negocio_id || '—'}
                                                        </span>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
