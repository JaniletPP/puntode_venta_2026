// Cliente API - Ahora usa MySQL en lugar de base44
// Para volver a usar base44, comenta las siguientes líneas y descomenta las líneas al final

import { mysqlEntities } from './mysqlClient.js';

// Crear objeto base44 compatible con la estructura anterior
export const base44 = {
    entities: mysqlEntities,
    // Mantener integraciones por si se necesitan (upload de archivos, etc.)
    integrations: {
        Core: {
            UploadFile: async ({ file }) => {
                // Por ahora retornar una URL placeholder
                // En producción, implementar subida de archivos
                console.warn('UploadFile no implementado - usando placeholder');
                return { file_url: `https://via.placeholder.com/300?text=${file.name}` };
            }
        }
    },
    auth: {
        logout: () => {
            // Implementar logout si es necesario
            console.log('Logout llamado');
        }
    },
    /** Telemetría del SDK original; en modo local no hay backend de logs */
    appLogs: {
        logUserInApp: async () => {},
    },
};

// ============================================
// CÓDIGO ORIGINAL BASE44 (comentado)
// ============================================
// import { createClient } from '@base44/sdk';
// import { appParams } from '@/lib/app-params';
// 
// const { appId, token, functionsVersion, appBaseUrl } = appParams;
// 
// export const base44 = createClient({
//   appId,
//   token,
//   functionsVersion,
//   serverUrl: '',
//   requiresAuth: false,
//   appBaseUrl
// });
