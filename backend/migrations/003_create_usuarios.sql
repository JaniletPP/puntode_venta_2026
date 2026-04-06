-- Usuarios del sistema (login local). Rol: admin | supervisor | cajero

CREATE TABLE IF NOT EXISTS usuarios (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nombre VARCHAR(255) NULL,
    rol VARCHAR(20) NOT NULL DEFAULT 'cajero',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_usuarios_email (email),
    INDEX idx_usuarios_rol (rol)
);
