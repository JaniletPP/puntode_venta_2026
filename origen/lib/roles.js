/**
 * Roles por pantalla (UI). El backend sigue siendo la fuente de verdad.
 * admin: acceso total
 * supervisor: reportes
 * cajero/mesero: ventas (POS)
 */
export const PAGE_ROLES = {
    Dashboard: ['admin', 'superadmin', 'supervisor'],
    CorteCaja: ['admin', 'superadmin', 'supervisor'],
    POS: ['admin', 'superadmin', 'cajero', 'mesero'],
    Products: ['admin', 'superadmin'],
    Cards: ['admin', 'superadmin', 'cajero'],
    Usuarios: ['admin', 'superadmin'],
    Negocios: ['superadmin'],
};

export function canAccessPage(pageName, hasRoleFn) {
    if (typeof hasRoleFn !== 'function') return false;
    const req = PAGE_ROLES[pageName];
    if (!req?.length) return false;
    return req.some((r) => hasRoleFn([r]));
}

export function defaultLandingPage(hasRoleFn) {
    if (typeof hasRoleFn !== 'function') return 'POS';
    if (hasRoleFn(['supervisor']) && !hasRoleFn(['admin'])) return 'Dashboard';
    return 'POS';
}
