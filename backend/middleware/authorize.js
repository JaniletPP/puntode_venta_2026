/**
 * Autoriza según req.user.rol (debe ir después de authenticate).
 * @param {string[]} allowedRoles - ej. ['admin','supervisor']
 */
export function authorize(allowedRoles) {
    const allowed = allowedRoles.map((r) => String(r).toLowerCase());
    return (req, res, next) => {
        const rol = String(req.user?.rol || 'cajero').toLowerCase();
        if (rol === 'superadmin') return next();
        if (!allowed.includes(rol)) {
            return res.status(403).json({ error: 'Permiso denegado' });
        }
        next();
    };
}

/** Ventas/transacciones: lecturas para reportes; altas/bajas solo admin y cajero. */
export function authorizeVentas(req, res, next) {
    const m = req.method.toUpperCase();
    const readOnly = m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
    if (readOnly) {
        return authorize(['admin', 'supervisor', 'cajero', 'mesero'])(req, res, next);
    }
    return authorize(['admin', 'cajero'])(req, res, next);
}
