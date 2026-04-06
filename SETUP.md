# 🚀 Guía de Configuración - Sistema Punto de Venta con MySQL

Esta guía te ayudará a configurar y ejecutar el sistema completo con MySQL como base de datos.

## 📋 Requisitos Previos

- Node.js 18+ instalado
- MySQL 8.0+ instalado y corriendo
- npm o yarn instalado

## 📦 Estructura del Proyecto

```
tarjetas-inteligentes/
├── backend/              # API Node.js/Express
│   ├── config/          # Configuración de base de datos
│   ├── routes/          # Rutas de la API
│   └── server.js        # Servidor principal
├── database/            # Scripts SQL
│   └── punto_venta.sql # Script de creación de BD
├── origen/              # Frontend React
└── SETUP.md            # Esta guía
```

## 🔧 Paso 1: Configurar MySQL

### 1.1 Crear la Base de Datos

1. Abre phpMyAdmin o tu cliente MySQL favorito
2. Importa el archivo `database/punto_venta.sql`:
   - En phpMyAdmin: Ve a "Importar" → Selecciona `punto_venta.sql` → "Continuar"
   - O desde terminal:
     ```bash
     mysql -u root -p < database/punto_venta.sql
     ```

3. Verifica que la base de datos `punto_venta` fue creada con las tablas:
   - `productos`
   - `tarjetas`
   - `transacciones`
   - `transaccion_items`
   - `multas_estacionamiento`

### 1.2 Verificar Credenciales de MySQL

Anota tus credenciales de MySQL:
- **Host**: `localhost` (por defecto)
- **Usuario**: `root` (o tu usuario)
- **Contraseña**: (tu contraseña de MySQL)
- **Puerto**: `3306` (por defecto)

## 🔧 Paso 2: Configurar el Backend

### 2.1 Instalar Dependencias

```bash
cd backend
npm install
```

### 2.2 Configurar Variables de Entorno

1. Crea un archivo `.env` en la carpeta `backend/`:

```bash
# En Windows (PowerShell)
cd backend
Copy-Item env.example.txt .env

# En Linux/Mac
cd backend
cp env.example.txt .env
```

2. Edita el archivo `.env` con tus credenciales de MySQL:

```env
# Configuración de MySQL
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=tu_contraseña_aqui
DB_NAME=punto_venta
DB_PORT=3306

# Configuración del servidor
PORT=3001
NODE_ENV=development

# CORS
CORS_ORIGIN=http://localhost:5173
```

**⚠️ IMPORTANTE**: Reemplaza `tu_contraseña_aqui` con tu contraseña real de MySQL.

### 2.3 Iniciar el Backend

```bash
# Desde la carpeta backend/
npm start

# O en modo desarrollo (con auto-reload)
npm run dev
```

Deberías ver:
```
✅ Conexión a MySQL establecida correctamente
🚀 Servidor corriendo en http://localhost:3001
📡 API disponible en http://localhost:3001/api
✅ Base de datos conectada: punto_venta
```

### 2.4 Probar la API

Abre tu navegador y visita:
- http://localhost:3001/api/health

Deberías ver:
```json
{
  "status": "ok",
  "message": "API funcionando correctamente",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## 🔧 Paso 3: Configurar el Frontend

### 3.1 Instalar Dependencias (si no lo has hecho)

```bash
# Desde la raíz del proyecto
npm install
```

### 3.2 Configurar URL de la API (Opcional)

El frontend está configurado para usar `http://localhost:3001/api` por defecto.

Si necesitas cambiar la URL, crea un archivo `.env` en la raíz del proyecto:

```env
VITE_API_URL=http://localhost:3001/api
```

### 3.3 Iniciar el Frontend

```bash
# Desde la raíz del proyecto
npm run dev
```

El frontend debería iniciar en `http://localhost:5173`

## ✅ Paso 4: Verificar que Todo Funciona

### 4.1 Verificar Backend

1. Abre http://localhost:3001/api/products
   - Deberías ver una lista de productos en JSON

2. Abre http://localhost:3001/api/cards
   - Deberías ver una lista de tarjetas en JSON

### 4.2 Verificar Frontend

1. Abre http://localhost:5173 en tu navegador
2. Navega a la página "Productos"
   - Deberías ver los productos cargados desde MySQL
3. Navega a la página "Tarjetas"
   - Deberías ver las tarjetas cargadas desde MySQL
4. Prueba crear, editar o eliminar un producto
   - Los cambios deberían guardarse en MySQL

## 🔍 Solución de Problemas

### Error: "Cannot connect to MySQL"

**Causa**: Credenciales incorrectas o MySQL no está corriendo.

**Solución**:
1. Verifica que MySQL esté corriendo:
   ```bash
   # Windows
   net start MySQL80
   
   # Linux/Mac
   sudo systemctl start mysql
   ```

2. Verifica las credenciales en `backend/.env`
3. Prueba conectarte manualmente:
   ```bash
   mysql -u root -p
   ```

### Error: "ECONNREFUSED" en el frontend

**Causa**: El backend no está corriendo.

**Solución**:
1. Asegúrate de que el backend esté corriendo en el puerto 3001
2. Verifica que no haya otro proceso usando el puerto 3001
3. Revisa la consola del backend para ver errores

### Error: "CORS policy"

**Causa**: El frontend y backend están en diferentes puertos.

**Solución**:
- El backend ya está configurado para permitir CORS desde `http://localhost:5173`
- Si usas un puerto diferente, actualiza `CORS_ORIGIN` en `backend/.env`

### Error: "Table doesn't exist"

**Causa**: La base de datos no fue creada correctamente.

**Solución**:
1. Verifica que importaste `database/punto_venta.sql` correctamente
2. Verifica que estás usando la base de datos correcta:
   ```sql
   USE punto_venta;
   SHOW TABLES;
   ```

## 📚 Endpoints de la API

### Productos
- `GET /api/products` - Listar todos
- `GET /api/products/:id` - Obtener uno
- `POST /api/products` - Crear
- `PUT /api/products/:id` - Actualizar
- `DELETE /api/products/:id` - Eliminar

### Tarjetas
- `GET /api/cards` - Listar todas
- `GET /api/cards/:id` - Obtener una
- `GET /api/cards/number/:cardNumber` - Buscar por número
- `POST /api/cards` - Crear
- `PUT /api/cards/:id` - Actualizar
- `DELETE /api/cards/:id` - Eliminar

### Transacciones
- `GET /api/transactions` - Listar todas (con items)
- `GET /api/transactions/:id` - Obtener una (con items)
- `POST /api/transactions` - Crear (actualiza balance de tarjeta si es necesario)
- `PUT /api/transactions/:id` - Actualizar
- `DELETE /api/transactions/:id` - Eliminar

### Multas de Estacionamiento
- `GET /api/parking-tickets` - Listar todas
- `GET /api/parking-tickets/:id` - Obtener una
- `POST /api/parking-tickets` - Crear
- `PUT /api/parking-tickets/:id` - Actualizar
- `DELETE /api/parking-tickets/:id` - Eliminar

## 🎯 Próximos Pasos

1. **Personalizar la configuración**: Ajusta los valores por defecto según tus necesidades
2. **Agregar autenticación**: Implementa JWT o sesiones si es necesario
3. **Subida de archivos**: Implementa la funcionalidad de upload de imágenes
4. **Validaciones**: Agrega validaciones más estrictas en el backend
5. **Logs**: Implementa un sistema de logging más robusto

## 📝 Notas Importantes

- El backend usa IDs tipo UUID (string) para mantener compatibilidad con el esquema original
- Las transacciones automáticamente actualizan el balance de las tarjetas cuando son de tipo 'sale' o 'recharge'
- Los items de transacciones se guardan como "snapshot" para mantener el historial
- El frontend está configurado para usar MySQL por defecto, pero puedes volver a base44 comentando/descomentando código en `origen/api/base44Client.js`

## 🆘 Soporte

Si encuentras problemas:
1. Revisa los logs del backend en la consola
2. Revisa la consola del navegador (F12) para errores del frontend
3. Verifica que MySQL esté corriendo y accesible
4. Verifica que los puertos 3001 (backend) y 5173 (frontend) estén disponibles

---

¡Listo! Tu sistema debería estar funcionando con MySQL. 🎉
