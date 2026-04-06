import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { fetchApi, getApiBaseUrl, getNetworkErrorMessage, resolveNegocioIdForWrite } from '@/lib/apiConfig';
import { useAuth } from '@/lib/AuthContext';
import { useMutation } from '@tanstack/react-query';
import {
    parseSpreadsheetFile,
    mapRowToProduct,
    validateMappedRow,
    isRowEmpty,
    isAllowedImportExtension,
} from '@/lib/importProducts';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
    Plus, 
    Search, 
    Package, 
    Pencil, 
    Trash2,
    Upload,
    FileSpreadsheet,
    X,
} from "lucide-react";
class ProductsErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error('ProductsErrorBoundary:', error, info);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
                    <div className="max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-slate-800">Error en la página de productos</h2>
                        <p className="text-sm text-red-700 mt-2 break-words">{this.state.error?.message || 'Error desconocido'}</p>
                        <Button
                            type="button"
                            className="mt-4"
                            onClick={() => this.setState({ error: null })}
                        >
                            Reintentar
                        </Button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const categories = ['bebidas', 'alimentos', 'servicios', 'accesorios', 'otros'];

const INITIAL_FORM = {
    name: '',
    description: '',
    price: '',
    stock: '',
    category: 'otros',
    area: '',
    barcode: '',
    image_url: '',
    active: true,
};

const categoryColors = {
    bebidas: 'bg-blue-100 text-blue-700',
    alimentos: 'bg-green-100 text-green-700',
    servicios: 'bg-purple-100 text-purple-700',
    accesorios: 'bg-orange-100 text-orange-700',
    otros: 'bg-slate-100 text-slate-700'
};

/** Spinner sin SVG de lucide: alternar Loader2↔icono dentro de <Button> provoca insertBefore en React 18. */
function BtnSpinner({ className = '' }) {
    return (
        <span
            className={`inline-block shrink-0 rounded-full border-2 border-current border-t-transparent animate-spin ${className}`}
            aria-hidden
        />
    );
}

function ProductsPage() {
    const { selectedBusinessId, user } = useAuth();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [products, setProducts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [formData, setFormData] = useState(() => ({ ...INITIAL_FORM }));

    const fileImportRef = useRef(null);
    const [importDialogOpen, setImportDialogOpen] = useState(false);
    const [importPreview, setImportPreview] = useState([]);
    const [importParsing, setImportParsing] = useState(false);
    const [importSubmitting, setImportSubmitting] = useState(false);
    const [importResult, setImportResult] = useState(null);
    const [apiBanner, setApiBanner] = useState(null);
    /** Con el modal de producto abierto: captura lector USB (teclas + Enter) para rellenar código de barras. */
    const [barcodeScanMode, setBarcodeScanMode] = useState(false);
    const barcodeBufferRef = useRef('');
    const barcodeTimeoutRef = useRef(null);

    // showSpinner: false evita desmontar la tabla mientras un Dialog (importar) sigue abierto — Radix + insertBefore.
    const fetchProducts = async (options = {}) => {
        const { showSpinner = true } = options;
        try {
            if (showSpinner) setIsLoading(true);
            setApiBanner(null);
            const response = await fetchApi('/products');

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            const list = Array.isArray(data) ? data : [];
            const sortedData = [...list].sort(
                (a, b) =>
                    new Date(b?.created_at || b?.created_date || 0) -
                    new Date(a?.created_at || a?.created_date || 0),
            );
            setProducts(sortedData);
        } catch (error) {
            console.error('Error al cargar productos:', error);
            setProducts([]);
            const net = getNetworkErrorMessage(error);
            setApiBanner(net || 'No se pudo cargar la lista de productos.');
        } finally {
            if (showSpinner) setIsLoading(false);
        }
    };

    // Cargar productos al montar y cuando cambia el alcance de negocio (admin)
    useEffect(() => {
        fetchProducts();
    }, [selectedBusinessId]);

    /** Evita insertBefore (Radix Dialog + tabla): cerrar UI primero, luego refetch sin spinner. */
    const refreshProductsAfterDialog = async () => {
        await new Promise((resolve) => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => resolve());
            });
        });
        await fetchProducts({ showSpinner: false });
    };

    const createMutation = useMutation({
        mutationFn: (data) => base44.entities.Product.create(data),
        onSuccess: async () => {
            resetForm();
            setIsDialogOpen(false);
            await refreshProductsAfterDialog();
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.Product.update(id, data),
        onSuccess: async () => {
            resetForm();
            setIsDialogOpen(false);
            await refreshProductsAfterDialog();
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.Product.delete(id),
        onSuccess: async () => {
            await fetchProducts({ showSpinner: false });
        },
    });

    const resetForm = () => {
        setFormData({ ...INITIAL_FORM });
        setEditingProduct(null);
        setBarcodeScanMode(false);
        barcodeBufferRef.current = '';
        if (barcodeTimeoutRef.current) clearTimeout(barcodeTimeoutRef.current);
    };

    const applyScannedBarcode = useCallback(
        async (rawCode) => {
            const trimmed = String(rawCode).trim();
            if (trimmed.length < 3) return;
            try {
                const res = await fetchApi(
                    `/products?barcode=${encodeURIComponent(trimmed)}`,
                );
                if (res.ok) {
                    const data = await res.json();
                    if (Array.isArray(data) && data.length > 0) {
                        const existing = data[0];
                        const sameEdit =
                            editingProduct != null && String(existing.id) === String(editingProduct.id);
                        if (!sameEdit) {
                            window.alert('Ya existe un producto con este código de barras.');
                            return;
                        }
                    }
                }
            } catch (e) {
                console.warn('Comprobación código de barras:', e);
            }
            setFormData((prev) => ({ ...prev, barcode: trimmed }));
            setBarcodeScanMode(false);
            barcodeBufferRef.current = '';
        },
        [editingProduct],
    );

    useEffect(() => {
        if (!isDialogOpen || !barcodeScanMode || importDialogOpen) return undefined;

        const handleKeyDown = (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            if (e.key === 'Escape') {
                e.preventDefault();
                setBarcodeScanMode(false);
                barcodeBufferRef.current = '';
                if (barcodeTimeoutRef.current) clearTimeout(barcodeTimeoutRef.current);
                return;
            }

            if (barcodeTimeoutRef.current) clearTimeout(barcodeTimeoutRef.current);

            if (e.key === 'Enter') {
                const code = barcodeBufferRef.current.trim();
                barcodeBufferRef.current = '';
                if (code.length > 3) {
                    e.preventDefault();
                    e.stopPropagation();
                    applyScannedBarcode(code);
                }
                return;
            }

            if (e.key.length === 1 && !e.repeat) {
                e.preventDefault();
                e.stopPropagation();
                barcodeBufferRef.current += e.key;
            }

            barcodeTimeoutRef.current = setTimeout(() => {
                barcodeBufferRef.current = '';
            }, 100);
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            if (barcodeTimeoutRef.current) clearTimeout(barcodeTimeoutRef.current);
        };
    }, [isDialogOpen, barcodeScanMode, importDialogOpen, applyScannedBarcode]);

    const handleEdit = (product) => {
        setEditingProduct(product);
        setFormData({
            name: product.name || '',
            description: product.description || '',
            price: product.price?.toString() || '',
            stock: product.stock?.toString() || '',
            category: product.category || 'otros',
            area: product.area != null && String(product.area).trim() !== '' ? String(product.area).trim() : '',
            barcode: product.barcode || '',
            image_url: product.image_url || '',
            active: product.active !== false
        });
        setIsDialogOpen(true);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const data = {
            ...formData,
            price: parseFloat(formData.price) || 0,
            stock: parseInt(formData.stock) || 0,
            area: formData.area != null && String(formData.area).trim() !== ''
                ? String(formData.area).trim().slice(0, 50)
                : null,
        };

        if (editingProduct) {
            updateMutation.mutate({ id: editingProduct.id, data });
        } else {
            const negocio_id = resolveNegocioIdForWrite(selectedBusinessId, user?.negocio_id);
            createMutation.mutate({ ...data, negocio_id });
        }
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const { file_url } = await base44.integrations.Core.UploadFile({ file });
            setFormData(prev => ({ ...prev, image_url: file_url }));
        } catch (error) {
            console.error('Error uploading image:', error);
        }
    };

    const productList = Array.isArray(products) ? products : [];
    const filteredProducts = productList.filter((p) => p && typeof p === 'object' && (
        String(p.name ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(p.barcode ?? '').includes(searchTerm)
    ));

    const safeImportPreview = Array.isArray(importPreview) ? importPreview : [];
    const validImportCount = safeImportPreview.filter((r) => r?.valid).length;

    const handleImportFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;

        if (!isAllowedImportExtension(file.name)) {
            window.alert('Formato no válido. Usa .xlsx, .xls o .csv');
            return;
        }
        if (!file.size || file.size <= 0) {
            window.alert('El archivo está vacío');
            return;
        }

        setImportParsing(true);
        setImportResult(null);
        try {
            const rawRows = await parseSpreadsheetFile(file);
            if (!Array.isArray(rawRows)) {
                throw new Error('El archivo no produjo una tabla legible');
            }
            console.log('Datos cargados (filas):', rawRows.length);

            const preview = [];
            rawRows.forEach((raw, idx) => {
                try {
                    if (isRowEmpty(raw)) return;
                    const sourceRow = idx + 2;
                    const mapped = mapRowToProduct(raw);
                    const errs = validateMappedRow(mapped);
                    preview.push({
                        sourceRow,
                        mapped,
                        errs,
                        valid: errs.length === 0,
                    });
                } catch (rowErr) {
                    console.error('Error en fila', idx + 2, rowErr);
                    preview.push({
                        sourceRow: idx + 2,
                        mapped: {
                            name: '',
                            price: NaN,
                            stock: 0,
                            category: 'otros',
                            description: null,
                            barcode: null,
                            active: true,
                        },
                        errs: ['Error al leer esta fila'],
                        valid: false,
                    });
                }
            });

            setImportPreview(preview);
            setImportParsing(false);
            if (preview.length === 0) {
                window.alert('No se encontraron filas con datos. Revisa encabezados y el contenido del archivo.');
            }
            // Abrir modal en el siguiente frame: no mezclar cierre del spinner del botón con el portal en el mismo commit
            requestAnimationFrame(() => {
                setImportDialogOpen(true);
            });
        } catch (err) {
            console.error('Error leyendo Excel:', err);
            setImportPreview([]);
            window.alert(err?.message || 'Error al leer el archivo');
            setImportParsing(false);
        }
    };

    const handleConfirmImport = async () => {
        const validRows = (Array.isArray(importPreview) ? importPreview : []).filter((r) => r?.valid);
        if (validRows.length === 0) {
            window.alert('No hay filas válidas para importar.');
            return;
        }

        const payload = validRows.map(({ sourceRow, mapped }) => ({
            row: sourceRow,
            name: mapped.name,
            price: mapped.price,
            stock: mapped.stock,
            category: mapped.category,
            description: mapped.description,
            barcode: mapped.barcode,
            active: mapped.active,
            area: mapped.area ?? null,
        }));

        setImportSubmitting(true);
        setImportResult(null);
        try {
            const negocio_id = resolveNegocioIdForWrite(selectedBusinessId, user?.negocio_id);
            const data = await base44.entities.Product.bulk(payload, { negocio_id });

            if (!data || data.success !== true) {
                throw new Error(
                    typeof data?.error === 'string' ? data.error : 'El servidor no confirmó la importación',
                );
            }

            setImportResult(data);
            const errCount = data.errors?.length ?? 0;

            if (errCount === 0) {
                setImportDialogOpen(false);
                setImportPreview([]);
                setImportResult(null);
            }

            await fetchProducts({ showSpinner: false });

            if (errCount === 0) {
                window.alert(`Importación lista: ${data.inserted ?? 0} producto(s) creado(s).`);
            } else {
                window.alert(
                    `Se importaron ${data.inserted ?? 0} producto(s). ${errCount} fila(s) con error (revisa el cuadro de importación).`,
                );
            }
        } catch (err) {
            console.error(err);
            const net = getNetworkErrorMessage(err);
            const msg =
                net ||
                (err && typeof err.message === 'string'
                    ? err.message
                    : 'Error al importar. Comprueba que el backend esté en marcha (puerto 3001).');
            window.alert(msg);
        } finally {
            setImportSubmitting(false);
        }
    };

    const closeImportDialog = useCallback(() => {
        setImportDialogOpen(false);
        setImportPreview([]);
        setImportResult(null);
    }, []);

    useEffect(() => {
        const anyModal = importDialogOpen || isDialogOpen;
        if (!anyModal) return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            if (importDialogOpen) closeImportDialog();
            else {
                setIsDialogOpen(false);
                setFormData({ ...INITIAL_FORM });
                setEditingProduct(null);
            }
        };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [importDialogOpen, isDialogOpen, closeImportDialog]);

    return (
        <div className="min-h-screen bg-slate-50 p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {apiBanner && (
                    <div
                        role="alert"
                        className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
                    >
                        <p className="font-semibold">API no disponible</p>
                        <p className="mt-1">{apiBanner}</p>
                    </div>
                )}
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-800">Productos</h1>
                        <p className="text-slate-500 mt-1">Gestiona el inventario de tu punto de venta</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            ref={fileImportRef}
                            type="file"
                            accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                            className="hidden"
                            onChange={handleImportFile}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            className="border-indigo-200 text-indigo-800 hover:bg-indigo-50"
                            disabled={importParsing}
                            onClick={() => fileImportRef.current?.click()}
                        >
                            <span className="relative mr-2 inline-flex h-4 w-4 items-center justify-center">
                                <FileSpreadsheet
                                    className={`h-4 w-4 transition-opacity ${importParsing ? 'opacity-0' : 'opacity-100'}`}
                                />
                                <BtnSpinner
                                    className={`absolute h-4 w-4 text-indigo-700 ${importParsing ? 'opacity-100' : 'opacity-0'}`}
                                />
                            </span>
                            Importar Excel
                        </Button>

                    <Button
                        type="button"
                        className="bg-indigo-600 hover:bg-indigo-700"
                        onClick={() => {
                            resetForm();
                            setIsDialogOpen(true);
                        }}
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Nuevo Producto
                    </Button>

                    {isDialogOpen
                        ? createPortal(
                              <div
                                  className="fixed inset-0 z-[210] flex items-center justify-center p-4"
                                  role="dialog"
                                  aria-modal="true"
                                  aria-labelledby="product-modal-title"
                              >
                                  <button
                                      type="button"
                                      className="absolute inset-0 bg-black/80"
                                      onClick={() => {
                                          setIsDialogOpen(false);
                                          resetForm();
                                      }}
                                      aria-label="Cerrar formulario de producto"
                                  />
                                  <div
                                      className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg border bg-background p-6 shadow-lg"
                                      onClick={(e) => e.stopPropagation()}
                                  >
                                      <button
                                          type="button"
                                          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                          onClick={() => {
                                              setIsDialogOpen(false);
                                              resetForm();
                                          }}
                                          aria-label="Cerrar"
                                      >
                                          <X className="h-4 w-4" />
                                      </button>
                                      <h2
                                          id="product-modal-title"
                                          className="text-lg font-semibold leading-none tracking-tight pr-8 mb-4"
                                      >
                                          {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
                                      </h2>
                                      <form onSubmit={handleSubmit} className="space-y-4">
                                          <div className="grid grid-cols-2 gap-4">
                                              <div className="col-span-2">
                                                  <Label>Nombre</Label>
                                                  <Input
                                                      value={formData.name}
                                                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                                      placeholder="Nombre del producto"
                                                      required
                                                  />
                                              </div>
                                              <div>
                                                  <Label>Precio</Label>
                                                  <Input
                                                      type="number"
                                                      step="0.01"
                                                      value={formData.price}
                                                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                                      placeholder="0.00"
                                                      required
                                                  />
                                              </div>
                                              <div>
                                                  <Label>Stock</Label>
                                                  <Input
                                                      type="number"
                                                      value={formData.stock}
                                                      onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                                                      placeholder="0"
                                                  />
                                              </div>
                                              <div>
                                                  <Label>Categoría</Label>
                                                  <select
                                                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 capitalize"
                                                      value={formData.category}
                                                      onChange={(e) =>
                                                          setFormData({ ...formData, category: e.target.value })
                                                      }
                                                  >
                                                      {categories.map((cat) => (
                                                          <option key={cat} value={cat}>
                                                              {cat}
                                                          </option>
                                                      ))}
                                                  </select>
                                              </div>
                                              <div>
                                                  <Label>Área (corte de caja)</Label>
                                                  <Input
                                                      value={formData.area}
                                                      onChange={(e) =>
                                                          setFormData({ ...formData, area: e.target.value })
                                                      }
                                                      placeholder="bar, snack, merch…"
                                                      maxLength={50}
                                                  />
                                              </div>
                                              <div className="col-span-2 sm:col-span-1">
                                                  <div className="flex items-center justify-between gap-2 mb-1">
                                                      <Label htmlFor="product-form-barcode">Código de barras</Label>
                                                      <Button
                                                          type="button"
                                                          variant={barcodeScanMode ? 'secondary' : 'outline'}
                                                          size="sm"
                                                          className="h-7 text-xs shrink-0"
                                                          onClick={() => {
                                                              setBarcodeScanMode((v) => {
                                                                  const next = !v;
                                                                  if (next) {
                                                                      barcodeBufferRef.current = '';
                                                                      document.activeElement?.blur?.();
                                                                  }
                                                                  return next;
                                                              });
                                                          }}
                                                      >
                                                          {barcodeScanMode ? 'Cancelar escáner' : 'Escanear'}
                                                      </Button>
                                                  </div>
                                                  {barcodeScanMode && (
                                                      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mb-2">
                                                          Modo escáner: lee el código y Enter. Esc para salir. Puedes seguir editando el campo a mano si desactivas el modo.
                                                      </p>
                                                  )}
                                                  <Input
                                                      id="product-form-barcode"
                                                      value={formData.barcode}
                                                      onChange={(e) =>
                                                          setFormData({ ...formData, barcode: e.target.value })
                                                      }
                                                      placeholder="Opcional — escribe o usa «Escanear»"
                                                      autoComplete="off"
                                                  />
                                              </div>
                                              <div className="col-span-2">
                                                  <Label>Descripción</Label>
                                                  <Input
                                                      value={formData.description}
                                                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                                      placeholder="Descripción opcional"
                                                  />
                                              </div>
                                              <div className="col-span-2">
                                                  <Label>Imagen</Label>
                                                  <div className="flex gap-2">
                                                      <Input
                                                          value={formData.image_url}
                                                          onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                                                          placeholder="URL de la imagen"
                                                          className="flex-1"
                                                      />
                                                      <Button type="button" variant="outline" asChild>
                                                          <label className="cursor-pointer">
                                                              <Upload className="w-4 h-4" />
                                                              <input
                                                                  type="file"
                                                                  accept="image/*"
                                                                  className="hidden"
                                                                  onChange={handleImageUpload}
                                                              />
                                                          </label>
                                                      </Button>
                                                  </div>
                                              </div>
                                              <div className="col-span-2 flex items-center justify-between gap-3">
                                                  <Label htmlFor="product-active">Producto activo</Label>
                                                  <input
                                                      id="product-active"
                                                      type="checkbox"
                                                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                                      checked={formData.active}
                                                      onChange={(e) =>
                                                          setFormData({ ...formData, active: e.target.checked })
                                                      }
                                                  />
                                              </div>
                                          </div>
                                          <div className="flex gap-3 pt-4">
                                              <Button
                                                  type="button"
                                                  variant="outline"
                                                  className="flex-1"
                                                  onClick={() => {
                                                      setIsDialogOpen(false);
                                                      resetForm();
                                                  }}
                                              >
                                                  Cancelar
                                              </Button>
                                              <Button
                                                  type="submit"
                                                  className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                                                  disabled={createMutation.isPending || updateMutation.isPending}
                                              >
                                                  <span
                                                      className={`mr-2 inline-flex h-4 w-4 items-center justify-center ${createMutation.isPending || updateMutation.isPending ? 'opacity-100' : 'opacity-0'}`}
                                                  >
                                                      <BtnSpinner className="h-4 w-4" />
                                                  </span>
                                                  {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
                                              </Button>
                                          </div>
                                      </form>
                                  </div>
                              </div>,
                              document.body,
                          )
                        : null}
                    </div>
                </div>

                {importDialogOpen
                    ? createPortal(
                          <div
                              className="fixed inset-0 z-[200] flex items-center justify-center p-4"
                              role="dialog"
                              aria-modal="true"
                              aria-labelledby="import-modal-title"
                          >
                              <button
                                  type="button"
                                  className="absolute inset-0 bg-black/80"
                                  onClick={closeImportDialog}
                                  aria-label="Cerrar vista previa de importación"
                              />
                              <div
                                  className="relative z-10 flex w-full max-w-4xl max-h-[90vh] flex-col gap-4 rounded-lg border bg-background p-6 shadow-lg"
                                  onClick={(e) => e.stopPropagation()}
                              >
                                  <button
                                      type="button"
                                      className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                      onClick={closeImportDialog}
                                      aria-label="Cerrar"
                                  >
                                      <X className="h-4 w-4" />
                                  </button>

                                  <div className="flex flex-col space-y-1.5 pr-8 text-left">
                                      <h2 id="import-modal-title" className="text-lg font-semibold leading-none tracking-tight">
                                          Importar desde Excel / CSV
                                      </h2>
                                      <p className="text-sm text-slate-500 font-normal">
                                          Primera fila = encabezados. Columnas reconocidas: nombre/producto, precio, stock/cantidad, categoría, código, descripción.
                                      </p>
                                  </div>

                                  {importResult && (
                                      <div
                                          className={`rounded-lg border px-3 py-2 text-sm ${
                                              importResult.inserted > 0
                                                  ? 'bg-green-50 border-green-200 text-green-900'
                                                  : 'bg-amber-50 border-amber-200 text-amber-900'
                                          }`}
                                      >
                                          <p>
                                              <strong>{importResult.inserted ?? 0}</strong> producto(s) insertados.
                                              {importResult.errors?.length > 0 && (
                                                  <span> Revisa la lista de errores abajo.</span>
                                              )}
                                          </p>
                                      </div>
                                  )}

                                  <div className="flex-1 min-h-0 overflow-auto border rounded-md">
                                      <Table>
                                          <TableHeader>
                                              <TableRow className="bg-slate-50">
                                                  <TableHead className="w-14">Fila</TableHead>
                                                  <TableHead>Nombre</TableHead>
                                                  <TableHead className="text-right">Precio</TableHead>
                                                  <TableHead className="text-right">Stock</TableHead>
                                                  <TableHead>Categoría</TableHead>
                                                  <TableHead>Estado</TableHead>
                                              </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                              {safeImportPreview.length === 0 ? (
                                                  <TableRow>
                                                      <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                                                          No se detectaron filas con datos.
                                                      </TableCell>
                                                  </TableRow>
                                              ) : (
                                                  safeImportPreview.map((row, i) => (
                                                      <TableRow key={`import-${row?.sourceRow ?? i}-${i}`}>
                                                          <TableCell className="font-mono text-xs">{row?.sourceRow ?? '—'}</TableCell>
                                                          <TableCell className="max-w-[200px] truncate">
                                                              {row?.mapped?.name || '—'}
                                                          </TableCell>
                                                          <TableCell className="text-right">
                                                              {Number.isFinite(row?.mapped?.price) ? row.mapped.price : '—'}
                                                          </TableCell>
                                                          <TableCell className="text-right">
                                                              {row?.mapped?.stock ?? '—'}
                                                          </TableCell>
                                                          <TableCell className="capitalize text-xs">
                                                              {row?.mapped?.category ?? '—'}
                                                          </TableCell>
                                                          <TableCell>
                                                              {row?.valid ? (
                                                                  <Badge className="bg-green-100 text-green-800">OK</Badge>
                                                              ) : (
                                                                  <div className="space-y-1">
                                                                      <Badge variant="outline" className="border-red-200 text-red-700">
                                                                          Revisar
                                                                      </Badge>
                                                                      <p className="text-xs text-red-600 max-w-[220px]">
                                                                          {(Array.isArray(row?.errs) ? row.errs : []).join(' · ') || 'Revisar datos'}
                                                                      </p>
                                                                  </div>
                                                              )}
                                                          </TableCell>
                                                      </TableRow>
                                                  ))
                                              )}
                                          </TableBody>
                                      </Table>
                                  </div>

                                  {importResult?.errors?.length > 0 && (
                                      <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 max-h-32 overflow-auto text-xs">
                                          <p className="font-semibold text-red-800 mb-1">Errores del servidor (por fila)</p>
                                          <ul className="space-y-1 text-red-700">
                                              {importResult.errors.map((e, i) => (
                                                  <li key={i}>
                                                      Fila {e?.row ?? '—'}: {e?.message ?? 'Error desconocido'}
                                                  </li>
                                              ))}
                                          </ul>
                                      </div>
                                  )}

                                  <div className="flex justify-between items-center gap-2 pt-2">
                                      <p className="text-sm text-slate-600">
                                          Válidas: <strong>{validImportCount}</strong> de {safeImportPreview.length}
                                      </p>
                                      <div className="flex gap-2">
                                          <Button type="button" variant="outline" onClick={closeImportDialog}>
                                              Cerrar
                                          </Button>
                                          <Button
                                              type="button"
                                              className="bg-indigo-600 hover:bg-indigo-700"
                                              disabled={validImportCount === 0 || importSubmitting}
                                              onClick={handleConfirmImport}
                                          >
                                              <span
                                                  className={`mr-2 inline-flex h-4 w-4 items-center justify-center ${importSubmitting ? 'opacity-100' : 'opacity-0'}`}
                                              >
                                                  <BtnSpinner className="h-4 w-4" />
                                              </span>
                                              {importSubmitting
                                                  ? 'Importando…'
                                                  : `Confirmar importación (${validImportCount})`}
                                          </Button>
                                      </div>
                                  </div>
                              </div>
                          </div>,
                          document.body,
                      )
                    : null}

                {/* Search */}
                <Card className="border-0 shadow-sm">
                    <CardContent className="p-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <Input
                                placeholder="Buscar por nombre o código de barras..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 bg-slate-50 border-0"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Products Table */}
                <Card className="border-0 shadow-sm overflow-hidden">
                    <CardContent className="p-0">
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <BtnSpinner className="h-8 w-8 text-indigo-600" />
                            </div>
                        ) : filteredProducts.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                                <Package className="w-16 h-16 mb-4" />
                                <p className="text-lg">No hay productos</p>
                                <p className="text-sm">Agrega tu primer producto para comenzar</p>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50">
                                        <TableHead>Producto</TableHead>
                                        <TableHead>Categoría</TableHead>
                                        <TableHead>Área</TableHead>
                                        <TableHead className="text-right">Precio</TableHead>
                                        <TableHead className="text-right">Stock</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead className="text-right">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                        {filteredProducts.map((product, rowIndex) => (
                                            <TableRow
                                                key={`product-row-${rowIndex}-${String(product?.id ?? '')}-${String(product?.barcode ?? '')}`}
                                                className="group"
                                            >
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden">
                                                            {product.image_url ? (
                                                                <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <Package className="w-5 h-5 text-slate-400" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-slate-800">{product.name}</p>
                                                            {product.barcode && (
                                                                <p className="text-xs text-slate-400">{product.barcode}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={`${categoryColors[product.category] || categoryColors.otros} capitalize`}>
                                                        {product.category || 'otros'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-slate-600 text-sm capitalize">
                                                    {product.area ? String(product.area) : '—'}
                                                </TableCell>
                                                <TableCell className="text-right font-semibold">
                                                    ${Number(product.price || 0).toFixed(2)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <span className={Number(product.stock || 0) <= 5 ? 'text-red-500 font-semibold' : ''}>
                                                        {Number(product.stock || 0)}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={product.active !== false ? 'border-green-500 text-green-600' : 'border-slate-300 text-slate-500'}>
                                                        {product.active !== false ? 'Activo' : 'Inactivo'}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="w-8 h-8"
                                                            onClick={() => handleEdit(product)}
                                                        >
                                                            <Pencil className="w-4 h-4 text-slate-500" />
                                                        </Button>
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="w-8 h-8"
                                                            onClick={() => deleteMutation.mutate(product.id)}
                                                        >
                                                            <Trash2 className="w-4 h-4 text-red-500" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

export default function Products() {
    return (
        <ProductsErrorBoundary>
            <ProductsPage />
        </ProductsErrorBoundary>
    );
}