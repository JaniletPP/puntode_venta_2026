import express from 'express';
import pool from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

const CATEGORY_ENUM = ['bebidas', 'alimentos', 'servicios', 'accesorios', 'otros'];
const isGlobalAdmin = (req) => {
    const r = String(req.user?.rol || '').toLowerCase();
    return r === 'superadmin';
};
const resolveScopeNegocioId = (req) => {
    const role = String(req.user?.rol || '').toLowerCase();
    if (role === 'cajero' || role === 'mesero') return req.user?.negocio_id || 'negocio_default';
    if (isGlobalAdmin(req)) {
        const fromHeader = String(req.headers['x-negocio-id'] || '').trim();
        if (!fromHeader || fromHeader.toLowerCase() === 'all') return null;
        return fromHeader;
    }
    return req.user?.negocio_id || 'negocio_default';
};

/** Para INSERT: nunca usar "all" ni vacío; priorizar body → header (válido) → usuario. */
function resolveNegocioIdForWrite(req) {
    const role = String(req.user?.rol || '').toLowerCase();
    const pick = (v) => {
        const s = v != null ? String(v).trim() : '';
        if (!s || s.toLowerCase() === 'all') return '';
        return s;
    };
    if (role === 'cajero' || role === 'mesero') {
        return pick(req.user?.negocio_id) || 'negocio_default';
    }
    const fromBody = pick(req.body?.negocio_id);
    if (fromBody) return fromBody;
    const fromHeader = pick(req.headers['x-negocio-id']);
    if (fromHeader) return fromHeader;
    return pick(req.user?.negocio_id) || 'negocio_default';
}

function normalizeCategoryBulk(cat) {
    const c = String(cat ?? 'otros').trim().toLowerCase();
    return CATEGORY_ENUM.includes(c) ? c : 'otros';
}

/** Une campos en inglés (API) y alias en español (Excel / clientes legacy). */
function normalizeBulkRow(row) {
    const r = row && typeof row === 'object' && !Array.isArray(row) ? row : {};
    const name = typeof r.name === 'string'
        ? r.name.trim()
        : String(r.name ?? r.nombre ?? r.Nombre ?? r.Producto ?? r.producto ?? '').trim();
    const priceRaw = r.price ?? r.precio ?? r.Precio;
    const stockRaw = r.stock ?? r.Stock ?? r.cantidad ?? r.Cantidad;
    const category = r.category ?? r.categoria ?? r.Categoría ?? r.Categoria;
    const description = r.description ?? r.descripcion ?? r.Descripción ?? null;
    const barcodeRaw = r.barcode ?? r.codigo_barras ?? r.codigoBarras ?? r.Código ?? r.sku ?? r.SKU;
    const image_url = r.image_url ?? r.imageUrl ?? r.imagen ?? null;
    const areaRaw = r.area ?? r.zona ?? r.Area ?? null;
    const area =
        areaRaw != null && String(areaRaw).trim() !== ''
            ? String(areaRaw).trim().slice(0, 50)
            : null;
    let active = true;
    if (r.active !== undefined) {
        active = Boolean(r.active);
    } else if (r.estado !== undefined) {
        const e = String(r.estado).trim().toLowerCase();
        active = e === 'activo' || e === 'active' || e === 'true' || r.estado === true;
    }
    const barcode = barcodeRaw != null && String(barcodeRaw).trim() !== ''
        ? String(barcodeRaw).trim()
        : null;
    const desc = description != null && String(description).trim() !== ''
        ? String(description)
        : null;
    const img = image_url != null && String(image_url).trim() !== ''
        ? String(image_url).trim()
        : null;
    return {
        rowNum: r.row ?? r.fila ?? r.Row,
        name,
        price: Number(priceRaw),
        stockRaw,
        category: normalizeCategoryBulk(category),
        description: desc,
        barcode,
        image_url: img,
        area,
        active,
    };
}

// GET /api/products — listado o búsqueda por código de barras (?barcode=...)
router.get('/', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const barcode = req.query.barcode != null ? String(req.query.barcode).trim() : '';

        if (barcode) {
            const [rows] = !scopeNegocioId
                ? await pool.execute(
                    'SELECT *, created_at as created_date FROM productos WHERE barcode = ? LIMIT 1',
                    [barcode],
                )
                : await pool.execute(
                    'SELECT *, created_at as created_date FROM productos WHERE barcode = ? AND negocio_id = ? LIMIT 1',
                    [barcode, scopeNegocioId],
                );
            return res.json(rows);
        }

        const [rows] = !scopeNegocioId
            ? await pool.execute('SELECT *, created_at as created_date FROM productos ORDER BY created_at DESC')
            : await pool.execute(
                'SELECT *, created_at as created_date FROM productos WHERE negocio_id = ? ORDER BY created_at DESC',
                [scopeNegocioId],
            );
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener productos:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// POST /api/products/bulk — Importación masiva (debe ir antes de GET /:id)
// Cuerpo: { "products": [ ... ] } o un arreglo JSON directo.
router.post('/bulk', async (req, res) => {
    const negocioId = resolveNegocioIdForWrite(req);
    if (!negocioId) {
        return res.status(400).json({ error: 'negocio_id requerido (selecciona un negocio o asigna uno al usuario)' });
    }
    const items = Array.isArray(req.body?.products)
        ? req.body.products
        : (Array.isArray(req.body) ? req.body : null);

    if (!Array.isArray(items)) {
        return res.status(400).json({
            success: false,
            error: 'Formato inválido: envía un arreglo o { "products": [ ... ] }',
        });
    }

    if (items.length === 0) {
        return res.json({ success: true, inserted: 0, errors: [] });
    }

    const errors = [];
    const toInsert = [];

    for (let i = 0; i < items.length; i++) {
        const n = normalizeBulkRow(items[i]);
        const rowNum = n.rowNum != null ? Number(n.rowNum) : i + 1;

        let stockParsed = Number(n.stockRaw);
        if (Number.isNaN(stockParsed)) {
            stockParsed = parseInt(String(n.stockRaw ?? '0'), 10) || 0;
        }
        const stock = Math.max(0, Math.floor(stockParsed));

        if (!n.name) {
            errors.push({ row: rowNum, message: 'Nombre requerido' });
            continue;
        }
        if (Number.isNaN(n.price) || n.price < 0) {
            errors.push({ row: rowNum, message: 'Precio inválido' });
            continue;
        }
        if (Number.isNaN(stock) || stock < 0) {
            errors.push({ row: rowNum, message: 'Stock inválido' });
            continue;
        }

        toInsert.push({
            rowNum,
            name: n.name,
            description: n.description,
            price: n.price,
            stock,
            category: n.category,
            barcode: n.barcode,
            image_url: n.image_url,
            active: n.active,
            area: n.area,
        });
    }

    if (toInsert.length === 0) {
        return res.json({
            success: true,
            inserted: 0,
            errors,
        });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let inserted = 0;
        for (const row of toInsert) {
            const id = uuidv4();
            await connection.execute(
                `INSERT INTO productos (id, negocio_id, name, description, price, stock, category, barcode, image_url, active, area)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    negocioId,
                    row.name,
                    row.description,
                    row.price,
                    row.stock,
                    row.category,
                    row.barcode,
                    row.image_url,
                    row.active,
                    row.area ?? null,
                ],
            );
            inserted += 1;
        }

        await connection.commit();

        res.json({
            success: true,
            inserted,
            errors,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error en importación masiva (transacción):', error);
        console.error('negocioId (bulk):', negocioId);
        res.status(500).json({
            success: false,
            error: String(error?.message || error),
            detail: process.env.NODE_ENV === 'development' ? String(error?.stack || error?.message || error) : undefined,
        });
    } finally {
        connection.release();
    }
});

// GET /api/products/:id - Obtener un producto por ID
router.get('/:id', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const [rows] = !scopeNegocioId
            ? await pool.execute(
                'SELECT *, created_at as created_date FROM productos WHERE id = ?',
                [req.params.id]
            )
            : await pool.execute(
                'SELECT *, created_at as created_date FROM productos WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopeNegocioId]
            );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error('Error al obtener producto:', error);
        res.status(500).json({ error: 'Error al obtener producto' });
    }
});

// POST /api/products - Crear un nuevo producto
router.post('/', async (req, res) => {
    let negocioId;
    try {
        negocioId = resolveNegocioIdForWrite(req);
        if (!negocioId) {
            return res.status(400).json({ error: 'negocio_id requerido (selecciona un negocio o asigna uno al usuario)' });
        }
        const {
            name,
            description,
            price,
            stock = 0,
            category = 'otros',
            barcode,
            image_url,
            active = true,
            area = null,
        } = req.body;

        // Validar campos requeridos
        if (!name || price === undefined) {
            return res.status(400).json({ error: 'name y price son requeridos' });
        }

        const areaVal =
            area != null && String(area).trim() !== ''
                ? String(area).trim().slice(0, 50)
                : null;

        const id = uuidv4();
        await pool.execute(
            `INSERT INTO productos (id, negocio_id, name, description, price, stock, category, barcode, image_url, active, area)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, negocioId, name, description || null, price, stock, category, barcode || null, image_url || null, active, areaVal]
        );

        const [newProduct] = await pool.execute(
            'SELECT *, created_at as created_date FROM productos WHERE id = ? AND negocio_id = ?',
            [id, negocioId]
        );

        res.status(201).json(newProduct[0]);
    } catch (error) {
        console.error('Error al crear producto:', error);
        console.error('negocioId (create):', negocioId);
        res.status(500).json({
            error: String(error?.message || error),
            detail: process.env.NODE_ENV === 'development' ? String(error?.stack || error?.message || error) : undefined,
        });
    }
});

// PUT /api/products/:id - Actualizar un producto
router.put('/:id', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const {
            name,
            description,
            price,
            stock,
            category,
            barcode,
            image_url,
            active,
            area,
        } = req.body;

        // Verificar que el producto existe
        const [existing] = !scopeNegocioId
            ? await pool.execute(
                'SELECT * FROM productos WHERE id = ?',
                [req.params.id]
            )
            : await pool.execute(
                'SELECT * FROM productos WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopeNegocioId]
            );

        if (existing.length === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        // Construir query dinámico solo con los campos proporcionados
        const updates = [];
        const values = [];

        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (price !== undefined) { updates.push('price = ?'); values.push(price); }
        if (stock !== undefined) { updates.push('stock = ?'); values.push(stock); }
        if (category !== undefined) { updates.push('category = ?'); values.push(category); }
        if (barcode !== undefined) { updates.push('barcode = ?'); values.push(barcode); }
        if (image_url !== undefined) { updates.push('image_url = ?'); values.push(image_url); }
        if (active !== undefined) { updates.push('active = ?'); values.push(active); }
        if (area !== undefined) {
            updates.push('area = ?');
            values.push(
                area != null && String(area).trim() !== ''
                    ? String(area).trim().slice(0, 50)
                    : null,
            );
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });
        }

        if (!scopeNegocioId) {
            values.push(req.params.id);
            await pool.execute(
                `UPDATE productos SET ${updates.join(', ')} WHERE id = ?`,
                values
            );
        } else {
            values.push(req.params.id, scopeNegocioId);
            await pool.execute(
                `UPDATE productos SET ${updates.join(', ')} WHERE id = ? AND negocio_id = ?`,
                values
            );
        }

        const [updated] = !scopeNegocioId
            ? await pool.execute(
                'SELECT *, created_at as created_date FROM productos WHERE id = ?',
                [req.params.id]
            )
            : await pool.execute(
                'SELECT *, created_at as created_date FROM productos WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopeNegocioId]
            );

        res.json(updated[0]);
    } catch (error) {
        console.error('Error al actualizar producto:', error);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// DELETE /api/products/:id - Eliminar un producto
router.delete('/:id', async (req, res) => {
    try {
        const scopeNegocioId = resolveScopeNegocioId(req);
        const [result] = !scopeNegocioId
            ? await pool.execute(
                'DELETE FROM productos WHERE id = ?',
                [req.params.id]
            )
            : await pool.execute(
                'DELETE FROM productos WHERE id = ? AND negocio_id = ?',
                [req.params.id, scopeNegocioId]
            );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        res.json({ message: 'Producto eliminado correctamente' });
    } catch (error) {
        console.error('Error al eliminar producto:', error);
        res.status(500).json({ error: 'Error al eliminar producto' });
    }
});

export default router;
