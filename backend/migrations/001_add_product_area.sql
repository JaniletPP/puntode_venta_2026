-- Área del punto de venta (bar, snack, merch) para reportes de corte de caja.
-- Ejecutar una vez contra la base de datos del proyecto.

ALTER TABLE productos ADD COLUMN area VARCHAR(50) NULL DEFAULT NULL;
