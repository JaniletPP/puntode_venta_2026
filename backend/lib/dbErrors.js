/** Columna inexistente (MySQL 1054). */
export function isBadFieldError(err) {
    if (!err) return false;
    return err.errno === 1054 || String(err.code || '') === 'ER_BAD_FIELD_ERROR';
}

/** Tabla inexistente (MySQL 1146), p. ej. `negocios` sin migrar. */
export function isNoSuchTableError(err) {
    if (!err) return false;
    return err.errno === 1146 || String(err.code || '') === 'ER_NO_SUCH_TABLE';
}

export function isSchemaCompatError(err) {
    return isBadFieldError(err) || isNoSuchTableError(err);
}
