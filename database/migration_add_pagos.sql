-- Migración: tabla de pagos para ventas combinadas (ejecutar si ya tienes la BD creada sin esta tabla)
USE punto_venta;

CREATE TABLE IF NOT EXISTS pagos (
    id VARCHAR(255) PRIMARY KEY COMMENT 'ID único del pago',
    transaction_id VARCHAR(255) NOT NULL COMMENT 'Transacción asociada',
    tipo ENUM('tarjeta_interna', 'tarjeta_externa', 'efectivo', 'qr') NOT NULL COMMENT 'Medio de pago',
    metodo VARCHAR(255) NULL COMMENT 'Subtipo (ej. BBVA, Mercado Pago) para externo/QR',
    monto DECIMAL(10, 2) NOT NULL COMMENT 'Monto de esta línea',
    referencia VARCHAR(255) NULL COMMENT 'Referencia bancaria, folio terminal, etc.',
    card_id VARCHAR(255) NULL COMMENT 'Tarjeta interna si aplica',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de creación',
    FOREIGN KEY (transaction_id) REFERENCES transacciones(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (card_id) REFERENCES tarjetas(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_transaction_id (transaction_id),
    INDEX idx_tipo (tipo),
    INDEX idx_card_id (card_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
