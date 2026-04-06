import axios from 'axios';
import { getApiBaseUrl, getAuthToken, clearAuthToken } from './apiConfig';

export const apiClient = axios.create({
  baseURL: getApiBaseUrl(),
});

apiClient.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Si mandan un object, axios lo serializa y pone Content-Type automáticamente.
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    // Si el token ya no sirve, limpiarlo para no quedar en loops raros.
    const status = err?.response?.status;
    if (status === 401) {
      clearAuthToken();
    }
    return Promise.reject(err);
  },
);

