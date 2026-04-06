import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchApi } from '@/lib/apiConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Search, Wallet, Sparkles, X } from 'lucide-react';

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function maskCardNumber(num) {
  const s = String(num || '').trim();
  if (s.length <= 4) return s ? `****${s}` : '—';
  return `****${s.slice(-4)}`;
}

export default function CardRechargeDialog({ open, onClose, onSuccess }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selected, setSelected] = useState(null);
  const wrapRef = useRef(null);

  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
    setMonto('');
    setReferencia('');
    setSearchQuery('');
    setResults([]);
    setSelected(null);
    setShowDropdown(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchLoading(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetchApi(`/cards/search?q=${encodeURIComponent(q)}`);
        const data = await res.json().catch(() => []);
        if (cancelled) return;
        setResults(Array.isArray(data) ? data : []);
        setShowDropdown(true);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      const el = wrapRef.current;
      if (!el || el.contains(e.target)) return;
      setShowDropdown(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    const m = roundMoney(monto);
    if (!selected?.id) {
      setError('Busca y selecciona una tarjeta');
      return;
    }
    if (!(m > 0)) {
      setError('Ingresa un monto válido');
      return;
    }
    setSaving(true);
    try {
      const res = await fetchApi('/cards/recharge', {
        method: 'POST',
        body: {
          card_id: selected.id,
          monto: m,
          referencia: referencia.trim() || null,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data?.error || 'No se pudo recargar');
      }
      if (typeof onSuccess === 'function') onSuccess(data);
      onClose();
    } catch (e) {
      setError(e.message || 'Error al recargar');
    } finally {
      setSaving(false);
    }
  };

  const panel = (
    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-indigo-950/10">
      <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-800 px-5 py-5 text-white">
        <button
          type="button"
          className="absolute right-3 top-3 rounded-lg p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white"
          onClick={() => !saving && onClose()}
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="flex items-start gap-3 pr-10">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Recargar tarjeta</h2>
            <p className="mt-0.5 text-sm text-indigo-100">
              Busca por número o nombre y abona saldo de forma segura.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="space-y-2" ref={wrapRef}>
          <Label className="text-slate-700">Buscar tarjeta</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-11 border-slate-200 pl-9 shadow-sm"
              placeholder="Buscar tarjeta por número o nombre..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
              }}
              disabled={saving}
              autoComplete="off"
            />
            {searchLoading ? (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
              </div>
            ) : null}
            {showDropdown && results.filter((c) => String(c.status || '') === 'active').length > 0 ? (
              <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                {results
                  .filter((c) => String(c.status || '') === 'active')
                  .map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm transition hover:bg-indigo-50"
                        onClick={() => {
                          setSelected(c);
                          setShowDropdown(false);
                          setSearchQuery('');
                        }}
                      >
                        <span className="font-mono font-medium text-slate-900">{maskCardNumber(c.card_number)}</span>
                        <span className="text-xs text-slate-600">{c.holder_name}</span>
                        <span className="text-xs font-semibold text-emerald-700">
                          ${Number(c.balance || 0).toFixed(2)}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        </div>

        {selected ? (
          <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-b from-emerald-50/90 to-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-800/80">Tarjeta seleccionada</p>
                <p className="mt-1 font-semibold text-slate-900">{selected.holder_name}</p>
                <p className="font-mono text-sm text-slate-600">{maskCardNumber(selected.card_number)}</p>
              </div>
              <Wallet className="h-10 w-10 shrink-0 text-emerald-300" />
            </div>
            <div className="mt-3 rounded-xl bg-white/90 px-3 py-2 ring-1 ring-emerald-100">
              <p className="text-xs text-slate-500">Saldo actual</p>
              <p className="text-2xl font-bold tabular-nums text-emerald-700">
                ${Number(selected.balance || 0).toFixed(2)}
              </p>
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label className="text-slate-700">Monto a abonar</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            className="h-11 text-lg font-semibold tabular-nums"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-slate-600">Referencia (opcional)</Label>
          <Input
            className="h-10"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            disabled={saving}
            placeholder="Folio de depósito, nota…"
          />
        </div>

        {error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
        ) : null}

        <div className="flex gap-3 pt-1">
          <Button variant="outline" className="flex-1 h-11" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            className="flex-1 h-11 bg-indigo-600 text-base font-semibold hover:bg-indigo-700"
            onClick={submit}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Procesando…
              </>
            ) : (
              'Confirmar recarga'
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]" onClick={() => !saving && onClose()} />
      <div className="relative z-10 w-full max-w-md">{panel}</div>
    </div>,
    document.body,
  );
}
