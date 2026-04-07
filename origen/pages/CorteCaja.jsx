import React, { useState } from 'react';
import { fetchApi } from '@/lib/apiConfig';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';

function todayISODate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatMoney(n) {
    const x = Number(n) || 0;
    return x.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getQuickRange(type) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (type === 'today') {
        return { inicio: toISODate(today), fin: toISODate(today) };
    }
    if (type === 'yesterday') {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return { inicio: toISODate(y), fin: toISODate(y) };
    }
    if (type === 'week') {
        const day = today.getDay(); // 0 domingo
        const diff = day === 0 ? 6 : day - 1; // semana desde lunes
        const start = new Date(today);
        start.setDate(today.getDate() - diff);
        return { inicio: toISODate(start), fin: toISODate(today) };
    }
    if (type === 'month') {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return { inicio: toISODate(start), fin: toISODate(today) };
    }
    return { inicio: toISODate(today), fin: toISODate(today) };
}

export default function CorteCaja() {
    const [inicio, setInicio] = useState(todayISODate());
    const [fin, setFin] = useState(todayISODate());
    const [quickRange, setQuickRange] = useState('today');
    const [loading, setLoading] = useState(false);
    const [loadingPdf, setLoadingPdf] = useState(false);
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);
    const areas = Array.isArray(data?.areas) ? data.areas : [];
    const productos = Array.isArray(data?.productos) ? data.productos : [];
    const totalEfectivo = areas.reduce((s, a) => s + Number(a?.metodos?.efectivo || 0), 0);
    const totalTerminal = areas.reduce((s, a) => s + Number(a?.metodos?.terminal || 0), 0);
    const totalTarjeta = areas.reduce((s, a) => s + Number(a?.metodos?.tarjeta || 0), 0);
    const totalGeneral = Number(data?.total_general || 0);
    const totalProductos = Number(data?.total_productos || 0);
    const metodosGenerales = data?.metodos_generales || { efectivo: totalEfectivo, terminal: totalTerminal, tarjeta: totalTarjeta };
    const numeroVentas = Number(data?.numero_ventas || 0);
    const chartData = areas.map((a) => ({
        area: String(a?.area || 'sin área').toUpperCase(),
        total: Number(a?.total || 0),
    }));

    const handleConsultar = async () => {
        try {
            setError(null);
            setLoading(true);
            const res = await fetchApi(
                `/reports/corte-caja?inicio=${encodeURIComponent(inicio)}&fin=${encodeURIComponent(fin)}`,
            );
            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || `Error ${res.status}`);
            }
            const json = await res.json();
            setData(json);
        } catch (err) {
            console.error(err);
            setData(null);
            setError('Error al consultar corte de caja');
            window.alert('Error al consultar corte de caja');
        } finally {
            setLoading(false);
        }
    };

    const handlePDF = async () => {
        try {
            setLoadingPdf(true);
            if (!data || !data.areas?.length) {
                window.alert('No hay datos');
                return;
            }
            const PdfCtor = jsPDF && jsPDF.jsPDF ? jsPDF.jsPDF : jsPDF;
            const pdf = new PdfCtor({ unit: 'mm', format: 'a4' });

            const pageW = 210;
            const pageH = 297;
            const margin = 12;
            const contentW = pageW - margin * 2;
            let y = 16;

            const drawHeader = () => {
                pdf.setFillColor(76, 29, 149);
                pdf.roundedRect(margin, 10, contentW, 22, 2, 2, 'F');
                pdf.setTextColor(255, 255, 255);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(16);
                pdf.text('CORTE DE CAJA', margin + 6, 19);
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(10);
                pdf.text(`Periodo: ${inicio || '-'} a ${fin || '-'}`, margin + 6, 27);
                pdf.text(`Generado: ${new Date().toLocaleString('es-MX')}`, margin + 120, 27);
                pdf.setTextColor(35, 35, 35);
            };

            const ensurePageSpace = (needed = 16) => {
                if (y + needed > pageH - margin) {
                    pdf.addPage();
                    drawHeader();
                    y = 40;
                }
            };

            drawHeader();
            y = 40;

            // Totales
            const kpiW = (contentW - 6) / 2;
            const drawKPI = (x, yy, title, value) => {
                pdf.setFillColor(248, 250, 252);
                pdf.setDrawColor(226, 232, 240);
                pdf.roundedRect(x, yy, kpiW, 14, 2, 2, 'FD');
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(9);
                pdf.text(title, x + 3, yy + 5);
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(10);
                pdf.text(value, x + 3, yy + 10.5);
            };
            drawKPI(margin, y, 'Total general', formatMoney(totalGeneral));
            drawKPI(margin + kpiW + 6, y, 'Número de ventas', String(numeroVentas));
            y += 18;
            drawKPI(margin, y, 'Total productos vendidos', String(totalProductos));
            drawKPI(margin + kpiW + 6, y, 'Total efectivo', formatMoney(metodosGenerales.efectivo));
            y += 18;
            drawKPI(margin, y, 'Total terminal', formatMoney(metodosGenerales.terminal));
            drawKPI(margin + kpiW + 6, y, 'Total tarjeta', formatMoney(metodosGenerales.tarjeta));
            y += 20;

            // Tabla
            const cols = [
                { key: 'area', label: 'Area', w: 34 },
                { key: 'cantidad', label: 'Cant.', w: 18 },
                { key: 'efectivo', label: 'Efectivo', w: 33 },
                { key: 'terminal', label: 'Terminal', w: 33 },
                { key: 'tarjeta', label: 'Tarjeta', w: 33 },
                { key: 'total', label: 'Total', w: 33 },
            ];
            const headerH = 8;
            const rowH = 7.5;
            const tableX = margin;
            const drawTableHeader = () => {
                pdf.setFillColor(99, 102, 241);
                pdf.rect(tableX, y, contentW, headerH, 'F');
                pdf.setTextColor(255, 255, 255);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(9);
                let x = tableX + 2;
                cols.forEach((c) => {
                    pdf.text(c.label, x, y + 5.3);
                    x += c.w;
                });
                y += headerH;
                pdf.setTextColor(35, 35, 35);
            };
            drawTableHeader();

            for (let i = 0; i < data.areas.length; i += 1) {
                ensurePageSpace(rowH + 2);
                if (y + rowH > pageH - margin) {
                    pdf.addPage();
                    drawHeader();
                    y = 40;
                    drawTableHeader();
                }
                const area = data.areas[i];
                if (i % 2 === 0) {
                    pdf.setFillColor(248, 250, 252);
                    pdf.rect(tableX, y, contentW, rowH, 'F');
                }
                pdf.setDrawColor(226, 232, 240);
                pdf.rect(tableX, y, contentW, rowH, 'S');
                pdf.setFont('helvetica', 'normal');
                pdf.setFontSize(8.5);

                const values = [
                    String(area?.area || 'SIN AREA').toUpperCase(),
                    String(area?.cantidad ?? 0),
                    formatMoney(area?.metodos?.efectivo),
                    formatMoney(area?.metodos?.terminal),
                    formatMoney(area?.metodos?.tarjeta),
                    formatMoney(area?.total),
                ];
                let x = tableX + 2;
                values.forEach((v, idx) => {
                    const isMoney = idx >= 2;
                    if (isMoney) {
                        pdf.text(v, x + cols[idx].w - 3, y + 5.2, { align: 'right' });
                    } else {
                        pdf.text(v, x, y + 5.2);
                    }
                    x += cols[idx].w;
                });
                y += rowH;
            }

            // Productos vendidos (top 30)
            if (Array.isArray(data.productos) && data.productos.length) {
                y += 10;
                ensurePageSpace(18);
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(12);
                pdf.text('PRODUCTOS VENDIDOS (TOP 30)', margin, y);
                y += 6;

                const pCols = [
                    { label: 'Producto', w: 110 },
                    { label: 'Cant.', w: 20 },
                    { label: 'Total', w: 40 },
                ];
                const headerH2 = 8;
                const rowH2 = 7.2;
                const drawPHeader = () => {
                    pdf.setFillColor(15, 23, 42);
                    pdf.rect(margin, y, contentW, headerH2, 'F');
                    pdf.setTextColor(255, 255, 255);
                    pdf.setFont('helvetica', 'bold');
                    pdf.setFontSize(9);
                    let x = margin + 2;
                    pCols.forEach((c) => { pdf.text(c.label, x, y + 5.3); x += c.w; });
                    y += headerH2;
                    pdf.setTextColor(35, 35, 35);
                };
                drawPHeader();
                const top = data.productos.slice(0, 30);
                for (let i = 0; i < top.length; i += 1) {
                    ensurePageSpace(rowH2 + 2);
                    if (y + rowH2 > pageH - margin) {
                        pdf.addPage();
                        drawHeader();
                        y = 40;
                        drawPHeader();
                    }
                    const p = top[i];
                    if (i % 2 === 0) {
                        pdf.setFillColor(248, 250, 252);
                        pdf.rect(margin, y, contentW, rowH2, 'F');
                    }
                    pdf.setDrawColor(226, 232, 240);
                    pdf.rect(margin, y, contentW, rowH2, 'S');
                    pdf.setFont('helvetica', 'normal');
                    pdf.setFontSize(8.5);
                    const name = String(p?.nombre || 'Producto').slice(0, 44);
                    pdf.text(name, margin + 2, y + 5.1);
                    pdf.text(String(p?.cantidad ?? 0), margin + 2 + pCols[0].w + pCols[1].w - 3, y + 5.1, { align: 'right' });
                    pdf.text(formatMoney(p?.total), margin + 2 + pCols[0].w + pCols[1].w + pCols[2].w - 3, y + 5.1, { align: 'right' });
                    y += rowH2;
                }
            }
            pdf.save('corte_caja.pdf');
        } catch (err) {
            console.error(err);
            window.alert('Error al generar PDF');
        } finally {
            setLoadingPdf(false);
        }
    };

    const handleQuickRange = (type) => {
        const r = getQuickRange(type);
        setInicio(r.inicio);
        setFin(r.fin);
        setQuickRange(type);
    };

    const handleChangeInicio = (value) => {
        setInicio(value);
        setQuickRange(null);
    };

    const handleChangeFin = (value) => {
        setFin(value);
        setQuickRange(null);
    };

    const handleExcel = () => {
        if (!areas.length) {
            window.alert('No hay datos para exportar');
            return;
        }
        const rows = [
            {
                Area: 'TOTAL GENERAL',
                Cantidad: numeroVentas,
                Efectivo: totalEfectivo,
                Terminal: totalTerminal,
                Tarjeta: totalTarjeta,
                Total: totalGeneral,
            },
            ...areas.map((a) => ({
                Area: String(a?.area || 'SIN AREA').toUpperCase(),
                Cantidad: Number(a?.cantidad || 0),
                Efectivo: Number(a?.metodos?.efectivo || 0),
                Terminal: Number(a?.metodos?.terminal || 0),
                Tarjeta: Number(a?.metodos?.tarjeta || 0),
                Total: Number(a?.total || 0),
            })),
        ];
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'CorteCaja');
        XLSX.writeFile(wb, `corte_caja_${inicio}_${fin}.xlsx`);
    };

    return (
        <div className="min-h-screen bg-slate-100 p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800">Corte de caja por área</h1>
                    <p className="text-slate-500 mt-1">
                        Ventas por área de producto y método de pago (efectivo, terminal, tarjeta).
                    </p>
                </div>

                <Card className="border-0 shadow-md">
                    <CardHeader>
                        <CardTitle className="text-lg">Filtros</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="corte-inicio">Fecha inicio</Label>
                                <Input
                                    id="corte-inicio"
                                    type="date"
                                    value={inicio}
                                    onChange={(e) => handleChangeInicio(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="corte-fin">Fecha fin</Label>
                                <Input
                                    id="corte-fin"
                                    type="date"
                                    value={fin}
                                    onChange={(e) => handleChangeFin(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant={quickRange === 'today' ? 'default' : 'outline'}
                                className={quickRange === 'today' ? 'bg-violet-600 hover:bg-violet-700 text-white' : ''}
                                onClick={() => handleQuickRange('today')}
                            >
                                Hoy
                            </Button>
                            <Button
                                type="button"
                                variant={quickRange === 'yesterday' ? 'default' : 'outline'}
                                className={quickRange === 'yesterday' ? 'bg-violet-600 hover:bg-violet-700 text-white' : ''}
                                onClick={() => handleQuickRange('yesterday')}
                            >
                                Ayer
                            </Button>
                            <Button
                                type="button"
                                variant={quickRange === 'week' ? 'default' : 'outline'}
                                className={quickRange === 'week' ? 'bg-violet-600 hover:bg-violet-700 text-white' : ''}
                                onClick={() => handleQuickRange('week')}
                            >
                                Semana
                            </Button>
                            <Button
                                type="button"
                                variant={quickRange === 'month' ? 'default' : 'outline'}
                                className={quickRange === 'month' ? 'bg-violet-600 hover:bg-violet-700 text-white' : ''}
                                onClick={() => handleQuickRange('month')}
                            >
                                Mes
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                className="bg-indigo-600 hover:bg-indigo-700"
                                onClick={handleConsultar}
                                disabled={loading}
                            >
                                {loading ? 'Cargando...' : 'Consultar'}
                            </Button>
                            <Button
                                type="button"
                                className="bg-violet-600 hover:bg-violet-700 text-white"
                                onClick={handlePDF}
                                disabled={loadingPdf}
                            >
                                {loadingPdf ? 'Generando PDF...' : 'Descargar PDF'}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleExcel}
                                disabled={!areas.length}
                            >
                                Exportar Excel
                            </Button>
                        </div>
                        {error && (
                            <div
                                role="alert"
                                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                            >
                                {error}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <div id="reporte" className="space-y-6">
                    <Card className="border-0 shadow-md">
                        <CardHeader>
                            <CardTitle className="text-xl">Reporte de corte</CardTitle>
                            <p className="text-sm text-slate-500">
                                Periodo: {inicio || '-'} — {fin || '-'}
                            </p>
                        </CardHeader>
                        <CardContent>
                            {!data && !loading && (
                                <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
                                    Selecciona fechas y consulta para ver el corte
                                </div>
                            )}

                            {loading ? (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse">
                                    <div className="h-24 rounded-xl bg-slate-200" />
                                    <div className="h-24 rounded-xl bg-slate-200" />
                                    <div className="h-24 rounded-xl bg-slate-200" />
                                </div>
                            ) : null}

                            {data && (
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                                        <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 shadow-sm">
                                            <p className="text-sm text-blue-700">Total general</p>
                                            <p className="text-2xl font-bold text-blue-900">{formatMoney(totalGeneral)}</p>
                                        </div>
                                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 shadow-sm">
                                        <p className="text-sm text-slate-600">Productos vendidos</p>
                                        <p className="text-2xl font-bold text-slate-900">{String(totalProductos)}</p>
                                    </div>
                                        <div className="rounded-xl bg-green-50 border border-green-100 p-4 shadow-sm">
                                            <p className="text-sm text-green-700">Total efectivo</p>
                                        <p className="text-2xl font-bold text-green-900">{formatMoney(metodosGenerales.efectivo)}</p>
                                        </div>
                                        <div className="rounded-xl bg-violet-50 border border-violet-100 p-4 shadow-sm">
                                            <p className="text-sm text-violet-700">Total terminal</p>
                                        <p className="text-2xl font-bold text-violet-900">{formatMoney(metodosGenerales.terminal)}</p>
                                        </div>
                                        <div className="rounded-xl bg-orange-50 border border-orange-100 p-4 shadow-sm">
                                            <p className="text-sm text-orange-700">Total tarjeta</p>
                                        <p className="text-2xl font-bold text-orange-900">{formatMoney(metodosGenerales.tarjeta)}</p>
                                        </div>
                                        <div className="rounded-xl bg-white border border-slate-200 p-4 shadow-sm">
                                            <p className="text-sm text-slate-500">Número de ventas</p>
                                            <p className="text-2xl font-bold text-slate-900">{numeroVentas}</p>
                                        </div>
                                    </div>

                                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                                        <h3 className="font-semibold text-slate-800 mb-3">Total por área</h3>
                                        <div className="h-[260px]">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={chartData}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                                    <XAxis dataKey="area" tick={{ fontSize: 12 }} />
                                                    <YAxis tickFormatter={(v) => `$${Number(v).toFixed(0)}`} tick={{ fontSize: 12 }} />
                                                    <Tooltip
                                                        formatter={(value) => formatMoney(value)}
                                                        contentStyle={{ borderRadius: 10, borderColor: '#e2e8f0' }}
                                                    />
                                                    <Bar dataKey="total" fill="#7c3aed" radius={[8, 8, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-md">
                        <CardHeader>
                            <CardTitle className="text-lg">Desglose por área</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {areas.length > 0 ? (
                                <div className="overflow-hidden rounded-xl border border-slate-200">
                                    <div className="grid grid-cols-6 bg-violet-700 text-white text-sm font-semibold px-4 py-3">
                                        <div>Área</div>
                                        <div className="text-center">Cantidad</div>
                                        <div className="text-right">Efectivo</div>
                                        <div className="text-right">Terminal</div>
                                        <div className="text-right">Tarjeta</div>
                                        <div className="text-right">Total</div>
                                    </div>
                                    {areas.map((area, index) => (
                                        <div
                                            key={`${area?.area || 'sin-area'}-${index}`}
                                            className={`grid grid-cols-6 px-4 py-3 text-sm border-t border-slate-100 transition-colors ${
                                                index % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                                            } hover:bg-violet-50`}
                                        >
                                            <div className="font-medium text-slate-800">
                                                {String(area?.area || 'sin área').toUpperCase()}
                                            </div>
                                            <div className="text-center text-slate-600">{area?.cantidad ?? 0}</div>
                                            <div className="text-right text-green-700 font-medium">
                                                {formatMoney(area?.metodos?.efectivo)}
                                            </div>
                                            <div className="text-right text-violet-700 font-medium">
                                                {formatMoney(area?.metodos?.terminal)}
                                            </div>
                                            <div className="text-right text-orange-700 font-medium">
                                                {formatMoney(area?.metodos?.tarjeta)}
                                            </div>
                                            <div className="text-right font-bold text-slate-900">
                                                {formatMoney(area?.total)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                !loading && (
                                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
                                        Selecciona fechas y consulta para ver el corte
                                    </div>
                                )
                            )}
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-md">
                        <CardHeader>
                            <CardTitle className="text-lg">Productos vendidos</CardTitle>
                            <p className="text-sm text-slate-500">
                                Nombre, cantidad y total generado por producto.
                            </p>
                        </CardHeader>
                        <CardContent>
                            {productos.length > 0 ? (
                                <div className="overflow-hidden rounded-xl border border-slate-200">
                                    <div className="grid grid-cols-12 bg-slate-900 text-white text-sm font-semibold px-4 py-3">
                                        <div className="col-span-7">Producto</div>
                                        <div className="col-span-2 text-right">Cantidad</div>
                                        <div className="col-span-3 text-right">Total</div>
                                    </div>
                                    {productos.map((p, idx) => (
                                        <div
                                            key={`${p.product_id || p.nombre}-${idx}`}
                                            className={`grid grid-cols-12 px-4 py-3 text-sm border-t border-slate-100 ${
                                                idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'
                                            }`}
                                        >
                                            <div className="col-span-7 font-medium text-slate-800">{p.nombre}</div>
                                            <div className="col-span-2 text-right text-slate-700">{String(p.cantidad ?? 0)}</div>
                                            <div className="col-span-3 text-right font-semibold text-slate-900">{formatMoney(p.total)}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-500">No hay productos vendidos en este periodo.</p>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
