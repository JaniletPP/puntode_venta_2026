import express from 'express';
import pool from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// GET /api/negocios
router.get('/', async (_req, res) => {
    try {
        const [rows] = await pool.execute(
            `SELECT n.id, n.nombre, n.tipo, n.created_at, COUNT(u.id) AS usuarios_count
             FROM negocios n
             LEFT JOIN usuarios u ON u.negocio_id = n.id
             GROUP BY n.id, n.nombre, n.tipo, n.created_at
             ORDER BY n.created_at DESC`,
        );
        res.json(rows);
    } catch (error) {
        console.error('Listar negocios:', error);
        res.status(500).json({ error: 'Error al listar negocios' });
    }
});

// POST /api/negocios
router.post('/', async (req, res) => {
    try {
        const nombre = String(req.body?.nombre || '').trim();
        const tipo = String(req.body?.tipo || '').trim() || null;
        if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

        const id = uuidv4();
        await pool.execute(
            'INSERT INTO negocios (id, nombre, tipo) VALUES (?, ?, ?)',
            [id, nombre, tipo],
        );
        const [rows] = await pool.execute(
            'SELECT id, nombre, tipo, created_at FROM negocios WHERE id = ? LIMIT 1',
            [id],
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Crear negocio:', error);
        res.status(500).json({ error: 'Error al crear negocio' });
    }
});

// PUT /api/negocios/:id
router.put('/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const nombre = req.body?.nombre;
        const tipo = req.body?.tipo;

        const updates = [];
        const values = [];
        if (nombre !== undefined) {
            updates.push('nombre = ?');
            values.push(String(nombre || '').trim());
        }
        if (tipo !== undefined) {
            updates.push('tipo = ?');
            values.push(String(tipo || '').trim() || null);
        }
        if (!updates.length) return res.status(400).json({ error: 'No hay campos para actualizar' });

        values.push(id);
        const [result] = await pool.execute(
            `UPDATE negocios SET ${updates.join(', ')} WHERE id = ?`,
            values,
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Negocio no encontrado' });

        const [rows] = await pool.execute(
            'SELECT id, nombre, tipo, created_at FROM negocios WHERE id = ? LIMIT 1',
            [id],
        );
        res.json(rows[0]);
    } catch (error) {
        console.error('Actualizar negocio:', error);
        res.status(500).json({ error: 'Error al actualizar negocio' });
    }
});

// DELETE /api/negocios/:id (si tiene usuarios, bloquea)
router.delete('/:id', async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        if (id === 'negocio_default') {
            return res.status(400).json({ error: 'No se puede eliminar el negocio por defecto' });
        }
        const [u] = await pool.execute('SELECT COUNT(*) AS c FROM usuarios WHERE negocio_id = ?', [id]);
        if (Number(u?.[0]?.c || 0) > 0) {
            return res.status(400).json({ error: 'No se puede eliminar: tiene usuarios asignados' });
        }
        const [result] = await pool.execute('DELETE FROM negocios WHERE id = ?', [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Negocio no encontrado' });
        res.json({ ok: true });
    } catch (error) {
        console.error('Eliminar negocio:', error);
        res.status(500).json({ error: 'Error al eliminar negocio' });
    }
});

export default router;

