/**
 * URL base del API (sin barra final).
 * Por defecto apunta al backend en el mismo equipo (el proxy de Vite a /api puede fallar con algunos plugins).
 * En producción define VITE_API_URL, p. ej. https://api.tudominio.com
 */
export function getApiBaseUrl() {
    const v = import.meta.env.VITE_API_URL;
    if (typeof v === 'string' && v.trim() !== '') {
        return v.replace(/\/$/, '');
    }
    return 'http://localhost:3001/api';
}

const AUTH_TOKEN_KEY = 'pv_auth_token';
const SELECTED_BUSINESS_KEY = 'pv_selected_business_id';

export function getAuthToken() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token) {
    if (typeof localStorage === 'undefined') return;
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function clearAuthToken() {
    setAuthToken(null);
}

export function getSelectedBusinessId() {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SELECTED_BUSINESS_KEY);
}

export function setSelectedBusinessId(negocioId) {
    if (typeof localStorage === 'undefined') return;
    if (negocioId == null || negocioId === '') localStorage.removeItem(SELECTED_BUSINESS_KEY);
    else localStorage.setItem(SELECTED_BUSINESS_KEY, String(negocioId));
}

export function getAuthHeaders() {
    const t = getAuthToken();
    const negocioId = getSelectedBusinessId();
    const headers = t ? { Authorization: `Bearer ${t}` } : {};
    // No enviar "all": el backend lo interpreta como vista global; no es un id válido en INSERT.
    const nid = negocioId != null ? String(negocioId).trim() : '';
    if (nid && nid.toLowerCase() !== 'all') {
        headers['X-Negocio-Id'] = nid;
    }
    return headers;
}

/** Id de negocio para altas (productos, etc.): negocio seleccionado o el del usuario. */
export function resolveNegocioIdForWrite(selectedBusinessId, userNegocioId) {
    const sel = selectedBusinessId != null ? String(selectedBusinessId).trim() : '';
    if (sel && sel.toLowerCase() !== 'all') return sel;
    const u = userNegocioId != null ? String(userNegocioId).trim() : '';
    return u || 'negocio_default';
}

/** fetch al API sin credenciales (páginas públicas, ej. consulta de saldo cliente) */
export async function fetchPublicApi(path, options = {}) {
    const base = getApiBaseUrl();
    const p = path.startsWith('/') ? path : `/${path}`;
    const url = `${base}${p}`;
    const headers = { ...options.headers };
    let body = options.body;
    if (body != null && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        body = JSON.stringify(body);
        if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
        }
    }
    return fetch(url, {
        ...options,
        headers,
        body,
    });
}

/** fetch al API con Authorization si hay sesión local */
export async function fetchApi(path, options = {}) {
    const base = getApiBaseUrl();
    const p = path.startsWith('/') ? path : `/${path}`;
    const url = `${base}${p}`;
    const headers = { ...getAuthHeaders(), ...options.headers };
    let body = options.body;
    if (body != null && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
        body = JSON.stringify(body);
        if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
        }
    }
    return fetch(url, {
        ...options,
        headers,
        body,
    });
}

/** Mensaje claro cuando el backend no está levantado (Failed to fetch / ERR_CONNECTION_REFUSED). */
export function getNetworkErrorMessage(err) {
    if (!err) return null;
    const m = String(err.message || '');
    if (
        err.name === 'TypeError' &&
        (m.includes('Failed to fetch') || m.includes('fetch') || m.includes('NetworkError') || m.includes('Load failed'))
    ) {
        return 'No hay conexión con el backend (puerto 3001). Abre otra terminal en el proyecto y ejecuta: cd backend  luego  npm run dev  — deja esa ventana abierta mientras usas la app.';
    }
    return null;
}
