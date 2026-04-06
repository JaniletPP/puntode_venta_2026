-- Pagos parciales + Mercado Pago Point (estado, referencia_externa)

ALTER TABLE pagos
    ADD COLUMN referencia_externa VARCHAR(191) NULL COMMENT 'ID pago/intent Mercado Pago' AFTER referencia,
    ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'aprobado' COMMENT 'pendiente|aprobado|rechazado' AFTER referencia_externa;

UPDATE pagos SET estado = 'aprobado' WHERE estado IS NULL OR estado = '';
