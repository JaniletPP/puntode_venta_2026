import React, { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/apiConfig';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Building2, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

export default function Negocios() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ nombre: '', tipo: '' });
  const { negocios, fetchNegocios } = useAuth();

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      await fetchNegocios();
    } catch (e) {
      setError(e.message || 'Error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async () => {
    try {
      setSaving(true);
      setError('');
      const nombre = String(form.nombre || '').trim();
      if (!nombre) {
        setError('El nombre es requerido');
        return;
      }
      const res = await fetchApi('/negocios', {
        method: 'POST',
        body: {
          nombre,
          tipo: String(form.tipo || '').trim() || null,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Error al crear negocio');
      setForm({ nombre: '', tipo: '' });
      await load();
    } catch (e) {
      setError(e.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id, patch) => {
    const res = await fetchApi(`/negocios/${id}`, {
      method: 'PUT',
      body: patch,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || 'Error al actualizar');
    await load();
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este negocio?')) return;
    const res = await fetchApi(`/negocios/${id}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error || 'No se pudo eliminar');
      return;
    }
    await load();
  };

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 text-white">
              <Building2 className="w-6 h-6" />
            </span>
            Negocios
          </h1>
          <p className="text-slate-500 mt-1">Administración global de negocios</p>
        </div>

        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle>Crear negocio</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={form.nombre} onChange={(e) => setForm((p) => ({ ...p, nombre: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Input
                placeholder="bar, restaurante, snack..."
                value={form.tipo}
                onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value }))}
              />
            </div>
            <div className="flex items-end">
              <Button className="bg-violet-600 hover:bg-violet-700 w-full" onClick={handleCreate} disabled={saving}>
                {saving ? 'Guardando...' : 'Crear negocio'}
              </Button>
            </div>
            {error ? <p className="text-sm text-red-600 md:col-span-3">{error}</p> : null}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-md">
          <CardHeader>
            <CardTitle>Lista de negocios</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-slate-600 py-6">
                <Loader2 className="w-5 h-5 animate-spin" />
                Cargando...
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 hover:bg-slate-50">
                      <TableHead>Nombre</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Usuarios</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {negocios.map((n) => (
                      <TableRow key={n.id}>
                        <TableCell>
                          <Input
                            defaultValue={n.nombre || ''}
                            onBlur={(e) => {
                              const v = String(e.target.value || '').trim();
                              if (v && v !== n.nombre) handleUpdate(n.id, { nombre: v });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            defaultValue={n.tipo || ''}
                            onBlur={(e) => {
                              const v = String(e.target.value || '').trim();
                              if (v !== String(n.tipo || '')) handleUpdate(n.id, { tipo: v || null });
                            }}
                          />
                        </TableCell>
                        <TableCell>{Number(n.usuarios_count || 0)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="destructive" onClick={() => handleDelete(n.id)}>
                            Eliminar
                          </Button>
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

