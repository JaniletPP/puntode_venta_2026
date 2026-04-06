-- Tabla de pagos por transacción.
-- Necesaria para cobro mixto y reporte de corte de caja.

CREATE TABLE IF NOT EXISTS pagos (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    transaction_id VARCHAR(36) NOT NULL,
    tipo VARCHAR(30) NOT NULL,
    metodo VARCHAR(100) NULL,
    monto DECIMAL(10,2) NOT NULL,
    referencia VARCHAR(120) NULL,
    card_id VARCHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pagos_transaction_id (transaction_id),
    INDEX idx_pagos_card_id (card_id),
    INDEX idx_pagos_tipo (tipo),
    CONSTRAINT fk_pagos_transaction
        FOREIGN KEY (transaction_id) REFERENCES transacciones(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT fk_pagos_card
        FOREIGN KEY (card_id) REFERENCES tarjetas(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);
