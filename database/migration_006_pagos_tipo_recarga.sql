-- Añade 'recarga' al ENUM de pagos.tipo (recargas desde POS registradas en pagos).
USE punto_venta;

ALTER TABLE pagos
MODIFY COLUMN tipo ENUM(
    'tarjeta_interna',
    'tarjeta_externa',
    'efectivo',
    'qr',
    'recarga'
) NOT NULL COMMENT 'Medio de pago';
