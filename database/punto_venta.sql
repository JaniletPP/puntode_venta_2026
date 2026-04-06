-- =====================================================
-- BASE DE DATOS: PUNTO DE VENTA
-- =====================================================
-- Script SQL basado en los esquemas de /entidades
-- Respeta exactamente la estructura definida en los archivos JSON
-- =====================================================

-- Crear la base de datos
DROP DATABASE IF EXISTS punto_venta;
CREATE DATABASE punto_venta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE punto_venta;

-- =====================================================
-- TABLA: productos (basada en entidades/Producto)
-- =====================================================
CREATE TABLE productos (
    id VARCHAR(255) PRIMARY KEY COMMENT 'ID único del producto (string como en el esquema)',
    name VARCHAR(255) NOT NULL COMMENT 'Nombre del producto (required)',
    description TEXT COMMENT 'Descripción del producto',
    price DECIMAL(10, 2) NOT NULL COMMENT 'Precio del producto (required, number)',
    stock INT NOT NULL DEFAULT 0 COMMENT 'Cantidad en inventario (number, default 0)',
    category ENUM('bebidas', 'alimentos', 'servicios', 'accesorios', 'otros') NOT NULL DEFAULT 'otros' COMMENT 'Categoría del producto (enum)',
    barcode VARCHAR(100) COMMENT 'Código de barras (string)',
    image_url VARCHAR(500) COMMENT 'URL de la imagen del producto (string)',
    active BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Si el producto está activo (boolean, default true)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de creación',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Fecha de actualización',
    INDEX idx_category (category),
    INDEX idx_barcode (barcode),
    INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: tarjetas (basada en entidades/Tarjeta)
-- =====================================================
CREATE TABLE tarjetas (
    id VARCHAR(255) PRIMARY KEY COMMENT 'ID único de la tarjeta (string como en el esquema)',
    card_number VARCHAR(50) NOT NULL UNIQUE COMMENT 'Número único de la tarjeta (required, string)',
    holder_name VARCHAR(255) NOT NULL COMMENT 'Nombre del titular (required, string)',
    holder_phone VARCHAR(20) COMMENT 'Teléfono del titular (string)',
    balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT 'Saldo disponible (number, default 0)',
    status ENUM('active', 'inactive', 'blocked') NOT NULL DEFAULT 'active' COMMENT 'Estado de la tarjeta (enum, default active)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de creación',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Fecha de actualización',
    INDEX idx_card_number (card_number),
    INDEX idx_status (status),
    INDEX idx_holder_name (holder_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: transacciones (basada en entidades/Transacción)
-- =====================================================
CREATE TABLE transacciones (
    id VARCHAR(255) PRIMARY KEY COMMENT 'ID único de la transacción (string como en el esquema)',
    type ENUM('sale', 'recharge', 'parking', 'refund') NOT NULL COMMENT 'Tipo de transacción (required, enum)',
    amount DECIMAL(10, 2) NOT NULL COMMENT 'Monto de la transacción (required, number)',
    card_id VARCHAR(255) COMMENT 'ID de la tarjeta asociada (string, puede ser NULL)',
    card_number VARCHAR(50) COMMENT 'Número de tarjeta (string, duplicado para referencia)',
    description TEXT COMMENT 'Descripción de la transacción (string)',
    status ENUM('completed', 'pending', 'cancelled') NOT NULL DEFAULT 'completed' COMMENT 'Estado de la transacción (enum, default completed)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de creación',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Fecha de actualización',
    FOREIGN KEY (card_id) REFERENCES tarjetas(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_type (type),
    INDEX idx_card_id (card_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: transaccion_items (para el array items de Transaction)
-- =====================================================
CREATE TABLE transaccion_items (
    id VARCHAR(255) PRIMARY KEY COMMENT 'ID único del item',
    transaction_id VARCHAR(255) NOT NULL COMMENT 'ID de la transacción a la que pertenece',
    product_id VARCHAR(255) COMMENT 'ID del producto (string, puede ser NULL si fue eliminado)',
    product_name VARCHAR(255) NOT NULL COMMENT 'Nombre del producto al momento de la venta (string, snapshot)',
    quantity INT NOT NULL DEFAULT 1 COMMENT 'Cantidad (number)',
    unit_price DECIMAL(10, 2) NOT NULL COMMENT 'Precio unitario (number)',
    total DECIMAL(10, 2) NOT NULL COMMENT 'Total del item (number)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de creación',
    FOREIGN KEY (transaction_id) REFERENCES transacciones(id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (product_id) REFERENCES productos(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_transaction_id (transaction_id),
    INDEX idx_product_id (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TABLA: pagos (líneas de pago por transacción — ventas combinadas)
-- =====================================================
CREATE TABLE pagos (
    id VARCHAR(255) PRIMARY KEY COMMENT 'ID único del pago',
    transaction_id VARCHAR(255) NOT NULL COMMENT 'Transacción asociada',
    tipo ENUM('tarjeta_interna', 'tarjeta_externa', 'efectivo', 'qr', 'recarga') NOT NULL COMMENT 'Medio de pago',
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

-- =====================================================
-- TABLA: multas_estacionamiento (basada en entidades/Multa de estacionamiento)
-- =====================================================
CREATE TABLE multas_estacionamiento (
    id VARCHAR(255) PRIMARY KEY COMMENT 'ID único de la multa (string como en el esquema)',
    ticket_number VARCHAR(50) NOT NULL UNIQUE COMMENT 'Número de ticket (required, string)',
    plate_number VARCHAR(20) NOT NULL COMMENT 'Número de placa del vehículo (required, string)',
    vehicle_type ENUM('car', 'motorcycle', 'truck') NOT NULL DEFAULT 'car' COMMENT 'Tipo de vehículo (enum, default car)',
    entry_time DATETIME NOT NULL COMMENT 'Hora de entrada (required, date-time)',
    exit_time DATETIME COMMENT 'Hora de salida (date-time, puede ser NULL)',
    status ENUM('active', 'paid', 'cancelled') NOT NULL DEFAULT 'active' COMMENT 'Estado (enum, default active)',
    total_amount DECIMAL(10, 2) COMMENT 'Monto total a pagar (number)',
    card_id VARCHAR(255) COMMENT 'ID de tarjeta usada para pago (string)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'Fecha de creación',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Fecha de actualización',
    FOREIGN KEY (card_id) REFERENCES tarjetas(id) ON DELETE SET NULL ON UPDATE CASCADE,
    INDEX idx_ticket_number (ticket_number),
    INDEX idx_plate_number (plate_number),
    INDEX idx_status (status),
    INDEX idx_entry_time (entry_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- DATOS DE EJEMPLO
-- =====================================================

-- Insertar productos de ejemplo
INSERT INTO productos (id, name, description, price, stock, category, barcode, image_url, active) VALUES
('prod_001', 'Coca Cola 500ml', 'Refresco de cola en botella de 500ml', 15.00, 100, 'bebidas', '7501234567890', NULL, TRUE),
('prod_002', 'Agua Natural 1L', 'Agua purificada en botella de 1 litro', 12.00, 150, 'bebidas', '7501234567891', NULL, TRUE),
('prod_003', 'Hamburguesa Clásica', 'Hamburguesa con carne, lechuga, tomate y queso', 45.00, 50, 'alimentos', '7501234567892', NULL, TRUE),
('prod_004', 'Papas Fritas', 'Porción de papas fritas crujientes', 25.00, 80, 'alimentos', '7501234567893', NULL, TRUE),
('prod_005', 'Café Americano', 'Café negro americano caliente', 20.00, 200, 'bebidas', '7501234567894', NULL, TRUE),
('prod_006', 'Cargador USB-C', 'Cargador rápido USB-C para dispositivos móviles', 150.00, 30, 'accesorios', '7501234567895', NULL, TRUE),
('prod_007', 'Servicio de Lavado', 'Lavado completo de vehículo', 80.00, 999, 'servicios', 'SERV001', NULL, TRUE),
('prod_008', 'Auriculares Bluetooth', 'Auriculares inalámbricos con cancelación de ruido', 350.00, 25, 'accesorios', '7501234567896', NULL, TRUE),
('prod_009', 'Pizza Personal', 'Pizza personal con ingredientes a elegir', 55.00, 40, 'alimentos', '7501234567897', NULL, TRUE),
('prod_010', 'Energizante 250ml', 'Bebida energizante en lata de 250ml', 18.00, 120, 'bebidas', '7501234567898', NULL, TRUE);

-- Insertar tarjetas de ejemplo
INSERT INTO tarjetas (id, card_number, holder_name, holder_phone, balance, status) VALUES
('card_001', 'CARD001', 'Juan Pérez García', '5551234567', 500.00, 'active'),
('card_002', 'CARD002', 'María González López', '5552345678', 250.50, 'active'),
('card_003', 'CARD003', 'Carlos Rodríguez Martínez', '5553456789', 1000.00, 'active'),
('card_004', 'CARD004', 'Ana Martínez Sánchez', '5554567890', 0.00, 'active'),
('card_005', 'CARD005', 'Luis Hernández Torres', '5555678901', 750.25, 'active'),
('card_006', 'CARD006', 'Laura Díaz Ramírez', '5556789012', 300.00, 'inactive'),
('card_007', 'CARD007', 'Roberto Silva Morales', '5557890123', 0.00, 'blocked');

-- Insertar transacciones de ejemplo
INSERT INTO transacciones (id, type, amount, card_id, card_number, description, status) VALUES
('txn_001', 'sale', 60.00, 'card_001', 'CARD001', 'Venta de productos varios', 'completed'),
('txn_002', 'recharge', 200.00, 'card_002', 'CARD002', 'Recarga de saldo', 'completed'),
('txn_003', 'sale', 45.00, 'card_003', 'CARD003', 'Venta de hamburguesa', 'completed'),
('txn_004', 'parking', 25.00, 'card_001', 'CARD001', 'Pago de estacionamiento', 'completed'),
('txn_005', 'sale', 150.00, 'card_005', 'CARD005', 'Compra de accesorio', 'completed'),
('txn_006', 'refund', 45.00, 'card_003', 'CARD003', 'Reembolso por producto defectuoso', 'completed');

-- Insertar items de transacciones de ejemplo
INSERT INTO transaccion_items (id, transaction_id, product_id, product_name, quantity, unit_price, total) VALUES
('item_001', 'txn_001', 'prod_001', 'Coca Cola 500ml', 2, 15.00, 30.00),
('item_002', 'txn_001', 'prod_003', 'Hamburguesa Clásica', 1, 45.00, 45.00),
('item_003', 'txn_003', 'prod_003', 'Hamburguesa Clásica', 1, 45.00, 45.00),
('item_004', 'txn_005', 'prod_006', 'Cargador USB-C', 1, 150.00, 150.00),
('item_005', 'txn_006', 'prod_003', 'Hamburguesa Clásica', 1, 45.00, 45.00);

-- Insertar multas de estacionamiento de ejemplo
INSERT INTO multas_estacionamiento (id, ticket_number, plate_number, vehicle_type, entry_time, exit_time, status, total_amount, card_id) VALUES
('park_001', 'TICKET001', 'ABC123', 'car', '2024-01-15 08:30:00', '2024-01-15 10:45:00', 'paid', 25.00, 'card_001'),
('park_002', 'TICKET002', 'XYZ789', 'motorcycle', '2024-01-15 09:00:00', NULL, 'active', NULL, NULL),
('park_003', 'TICKET003', 'DEF456', 'car', '2024-01-14 14:20:00', '2024-01-14 16:30:00', 'paid', 30.00, 'card_003'),
('park_004', 'TICKET004', 'GHI789', 'truck', '2024-01-15 11:00:00', NULL, 'active', NULL, NULL),
('park_005', 'TICKET005', 'JKL012', 'car', '2024-01-13 07:15:00', '2024-01-13 09:00:00', 'paid', 20.00, 'card_005');

-- =====================================================
-- FIN DEL SCRIPT
-- =====================================================
