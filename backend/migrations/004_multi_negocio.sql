-- Multi-negocio base
CREATE TABLE IF NOT EXISTS negocios (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    tipo VARCHAR(100) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Negocio por defecto para datos legacy
INSERT INTO negocios (id, nombre, tipo)
SELECT 'negocio_default', 'Negocio principal', 'general'
WHERE NOT EXISTS (SELECT 1 FROM negocios WHERE id = 'negocio_default');

-- usuarios
ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS negocio_id VARCHAR(36) NULL AFTER nombre;

UPDATE usuarios
SET negocio_id = 'negocio_default'
WHERE negocio_id IS NULL OR negocio_id = '';

ALTER TABLE usuarios
    ADD INDEX IF NOT EXISTS idx_usuarios_negocio (negocio_id);

-- productos
ALTER TABLE productos
    ADD COLUMN IF NOT EXISTS negocio_id VARCHAR(36) NULL AFTER id;

UPDATE productos
SET negocio_id = 'negocio_default'
WHERE negocio_id IS NULL OR negocio_id = '';

ALTER TABLE productos
    ADD INDEX IF NOT EXISTS idx_productos_negocio (negocio_id);

-- transacciones
ALTER TABLE transacciones
    ADD COLUMN IF NOT EXISTS negocio_id VARCHAR(36) NULL AFTER id;

UPDATE transacciones
SET negocio_id = 'negocio_default'
WHERE negocio_id IS NULL OR negocio_id = '';

ALTER TABLE transacciones
    ADD INDEX IF NOT EXISTS idx_transacciones_negocio (negocio_id);

-- tarjetas (para aislar POS completamente por negocio)
ALTER TABLE tarjetas
    ADD COLUMN IF NOT EXISTS negocio_id VARCHAR(36) NULL AFTER id;

UPDATE tarjetas
SET negocio_id = 'negocio_default'
WHERE negocio_id IS NULL OR negocio_id = '';

ALTER TABLE tarjetas
    ADD INDEX IF NOT EXISTS idx_tarjetas_negocio (negocio_id);

-- multas estacionamiento
ALTER TABLE multas_estacionamiento
    ADD COLUMN IF NOT EXISTS negocio_id VARCHAR(36) NULL AFTER id;

UPDATE multas_estacionamiento
SET negocio_id = 'negocio_default'
WHERE negocio_id IS NULL OR negocio_id = '';

ALTER TABLE multas_estacionamiento
    ADD INDEX IF NOT EXISTS idx_multas_negocio (negocio_id);

-- pagos (opcional, pero útil para reportes y auditoría)
ALTER TABLE pagos
    ADD COLUMN IF NOT EXISTS negocio_id VARCHAR(36) NULL AFTER id;

UPDATE pagos
SET negocio_id = 'negocio_default'
WHERE negocio_id IS NULL OR negocio_id = '';

ALTER TABLE pagos
    ADD INDEX IF NOT EXISTS idx_pagos_negocio (negocio_id);

