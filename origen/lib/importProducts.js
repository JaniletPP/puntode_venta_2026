import * as XLSX from 'xlsx';

const CATEGORY_ALLOWED = ['bebidas', 'alimentos', 'servicios', 'accesorios', 'otros'];

/** Instancia única de SheetJS (Vite/CJS/ESM). */
function getXLSX() {
    const x = typeof XLSX?.read === 'function' ? XLSX : XLSX?.default;
    if (!x || typeof x.read !== 'function') {
        throw new Error('La biblioteca xlsx no está disponible');
    }
    return x;
}

export function normalizeKey(s) {
    return String(s ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '_');
}

function pickFirst(normalizedRow, keys) {
    for (const k of keys) {
        const v = normalizedRow[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
            return String(v).trim();
        }
    }
    return '';
}

function parseNumber(v, fallback = NaN) {
    if (v === undefined || v === null || v === '') return fallback;
    const s = String(v).replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(s.replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
}

function parseIntSafe(v, fallback = 0) {
    const n = parseNumber(v, NaN);
    if (Number.isNaN(n)) return fallback;
    return Math.max(0, Math.floor(n));
}

function normalizeCategory(raw) {
    const t = String(raw ?? '').trim();
    if (!t) return 'otros';
    const n = normalizeKey(raw).replace(/_/g, '');
    const map = {
        bebida: 'bebidas',
        bebidas: 'bebidas',
        alimento: 'alimentos',
        alimentos: 'alimentos',
        servicio: 'servicios',
        servicios: 'servicios',
        accesorio: 'accesorios',
        accesorios: 'accesorios',
        otro: 'otros',
        otros: 'otros',
    };
    const key = String(raw ?? '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    if (map[key]) return map[key];
    if (CATEGORY_ALLOWED.includes(key)) return key;
    return 'otros';
}

/**
 * Convierte una fila del Excel (objeto con claves = encabezados) a campos planos.
 */
export function mapRowToProduct(rawRow) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) {
        return {
            name: '',
            price: NaN,
            stock: 0,
            category: 'otros',
            description: null,
            barcode: null,
            area: null,
            active: true,
        };
    }

    const normalized = {};
    try {
        for (const [k, v] of Object.entries(rawRow)) {
            normalized[normalizeKey(k)] = v;
        }
    } catch {
        return {
            name: '',
            price: NaN,
            stock: 0,
            category: 'otros',
            description: null,
            barcode: null,
            area: null,
            active: true,
        };
    }

    const name = pickFirst(normalized, [
        'nombre',
        'producto',
        'name',
        'product',
        'articulo',
    ]);

    const priceRaw = pickFirst(normalized, ['precio', 'price', 'precio_unitario', 'costo', 'pvp']);
    const stockRaw = pickFirst(normalized, [
        'stock',
        'cantidad',
        'inventario',
        'qty',
        'quantity',
        'existencia',
    ]);

    const catRaw = pickFirst(normalized, ['categoria', 'category', 'tipo', 'rubro']);
    const description = pickFirst(normalized, ['descripcion', 'description', 'detalle', 'notas']);
    const barcode = pickFirst(normalized, ['codigo', 'barcode', 'codigo_de_barras', 'sku', 'ean']);
    const areaRaw = pickFirst(normalized, ['area', 'zona', 'sector']);

    const price = parseNumber(priceRaw, NaN);
    const stock = parseIntSafe(stockRaw, 0);

    const area =
        areaRaw && String(areaRaw).trim() !== ''
            ? String(areaRaw).trim().slice(0, 50)
            : null;

    return {
        name,
        price,
        stock,
        category: normalizeCategory(catRaw || 'otros'),
        description: description || null,
        barcode: barcode || null,
        area,
        active: true,
    };
}

/**
 * Valida un producto mapeado (para vista previa).
 */
export function validateMappedRow(p) {
    if (!p || typeof p !== 'object') {
        return ['Fila inválida'];
    }
    const errs = [];
    if (!p.name) errs.push('Nombre obligatorio');
    if (Number.isNaN(p.price) || p.price < 0) errs.push('Precio numérico ≥ 0');
    if (typeof p.stock !== 'number' || p.stock < 0 || !Number.isFinite(p.stock)) {
        errs.push('Stock numérico ≥ 0');
    }
    return errs;
}

export async function parseSpreadsheetFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
        throw new Error('No se recibió un archivo válido');
    }
    if (!file.size || file.size <= 0) {
        throw new Error('El archivo está vacío');
    }

    const xl = getXLSX();
    let buf;
    try {
        buf = await file.arrayBuffer();
    } catch (e) {
        throw new Error('No se pudo leer el contenido del archivo');
    }
    if (!buf || buf.byteLength === 0) {
        throw new Error('El archivo está vacío');
    }

    let wb;
    try {
        wb = xl.read(buf, { type: 'array' });
    } catch (e) {
        console.error('XLSX.read:', e);
        throw new Error('No se pudo interpretar el archivo. Usa .xlsx o .csv válido.');
    }

    if (!wb?.SheetNames?.length) {
        return [];
    }

    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
        return [];
    }

    let json;
    try {
        json = xl.utils.sheet_to_json(sheet, { defval: '', raw: false });
    } catch (e) {
        console.error('sheet_to_json:', e);
        throw new Error('No se pudo leer la hoja de cálculo');
    }

    return Array.isArray(json) ? json : [];
}

export function isRowEmpty(rawRow) {
    if (!rawRow || typeof rawRow !== 'object') return true;
    if (Array.isArray(rawRow)) return rawRow.length === 0;
    return Object.values(rawRow).every(
        (v) => v === '' || v === null || v === undefined || String(v).trim() === ''
    );
}

/** Extensiones permitidas (minúsculas, sin punto opcional). */
export function isAllowedImportExtension(fileName) {
    const n = String(fileName || '').toLowerCase();
    return n.endsWith('.xlsx') || n.endsWith('.xls') || n.endsWith('.csv');
}
