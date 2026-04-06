// Cliente API para conectar con el backend MySQL
// Reemplaza las llamadas a base44.entities con llamadas a la API local

import { getApiBaseUrl, getNetworkErrorMessage, getAuthHeaders } from '@/lib/apiConfig';

function humanizeFetchError(status, text) {
    const t = (text || '').trim();
    if (!t || t.startsWith('<!') || t.includes('<!DOCTYPE') || t.includes('<title>Error</title>')) {
        return `El servidor respondió con HTML (${status}) en lugar de JSON. Arranca el backend (carpeta backend, puerto 3001) y comprueba POST /api/products/bulk.`;
    }
    if (t.includes('Cannot POST') || t.includes('Cannot GET')) {
        return 'El servidor no tiene esa ruta (404). Reinicia el backend desde la carpeta backend y comprueba que exista POST /api/products/bulk.';
    }
    if (t.length > 400) {
        return `${t.slice(0, 400)}…`;
    }
    return t || `HTTP ${status}`;
}

// Función helper para hacer peticiones
async function request(endpoint, options = {}) {
    const API_BASE_URL = getApiBaseUrl();
    const url = `${API_BASE_URL}${endpoint}`;
    const config = {
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(),
            ...options.headers,
        },
        ...options,
    };

    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    try {
        const response = await fetch(url, config);
        const text = await response.text();

        let body = {};
        if (text) {
            try {
                body = JSON.parse(text);
            } catch {
                body = { _raw: text, error: humanizeFetchError(response.status, text) };
            }
        }

        if (!response.ok) {
            const baseMsg =
                (typeof body.error === 'string' && body.error) ||
                body.message ||
                humanizeFetchError(response.status, text);
            const detail =
                (typeof body.detail === 'string' && body.detail) ||
                (typeof body._raw === 'string' && body._raw) ||
                '';
            const msg =
                detail && !baseMsg.includes(detail)
                    ? `${baseMsg}\n${detail}`
                    : baseMsg;
            throw new Error(msg);
        }

        return body && typeof body === 'object' ? body : {};
    } catch (error) {
        console.error(`Error en ${endpoint}:`, error);
        const net = getNetworkErrorMessage(error);
        if (net) throw new Error(net);
        throw error;
    }
}

// Entidad Product
const Product = {
    async list(sort = '') {
        const products = await request('/products');
        // Simular ordenamiento si se requiere (el backend ya ordena por created_at DESC)
        if (sort === '-created_date' || sort === '-created_at') {
            return products.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        return products;
    },

    async get(id) {
        return await request(`/products/${id}`);
    },

    async create(data) {
        return await request('/products', {
            method: 'POST',
            body: data,
        });
    },

    async bulk(products, opts = {}) {
        const body = { products };
        if (opts.negocio_id != null && String(opts.negocio_id).trim() !== '') {
            body.negocio_id = String(opts.negocio_id).trim();
        }
        return await request('/products/bulk', {
            method: 'POST',
            body,
        });
    },

    async update(id, data) {
        return await request(`/products/${id}`, {
            method: 'PUT',
            body: data,
        });
    },

    async delete(id) {
        return await request(`/products/${id}`, {
            method: 'DELETE',
        });
    },
};

// Entidad Card
const Card = {
    async list(sort = '') {
        const cards = await request('/cards');
        if (sort === '-created_date' || sort === '-created_at') {
            return cards.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        return cards;
    },

    async get(id) {
        return await request(`/cards/${id}`);
    },

    async getByNumber(cardNumber) {
        return await request(`/cards/number/${cardNumber}`);
    },

    async create(data) {
        return await request('/cards', {
            method: 'POST',
            body: data,
        });
    },

    async update(id, data) {
        return await request(`/cards/${id}`, {
            method: 'PUT',
            body: data,
        });
    },

    async delete(id) {
        return await request(`/cards/${id}`, {
            method: 'DELETE',
        });
    },
};

// Entidad Transaction
const Transaction = {
    async list(sort = '', limit = null) {
        const transactions = await request('/transactions');
        let sorted = transactions;
        
        if (sort === '-created_date' || sort === '-created_at') {
            sorted = transactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }
        
        if (limit) {
            return sorted.slice(0, limit);
        }
        
        return sorted;
    },

    async get(id) {
        return await request(`/transactions/${id}`);
    },

    async create(data) {
        return await request('/transactions', {
            method: 'POST',
            body: data,
        });
    },

    async update(id, data) {
        return await request(`/transactions/${id}`, {
            method: 'PUT',
            body: data,
        });
    },

    async delete(id) {
        return await request(`/transactions/${id}`, {
            method: 'DELETE',
        });
    },
};

// Exportar objeto similar a base44.entities
export const mysqlEntities = {
    Product,
    Card,
    Transaction,
};

// Exportar función helper para compatibilidad
export default mysqlEntities;
