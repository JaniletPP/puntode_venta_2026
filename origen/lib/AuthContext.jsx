import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';
import { createAxiosClient } from '@base44/sdk/dist/utils/axios-client';
import {
  getApiBaseUrl,
  getAuthHeaders,
  clearAuthToken,
  setAuthToken,
  getAuthToken,
  getSelectedBusinessId,
  setSelectedBusinessId,
} from '@/lib/apiConfig';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings, setAppPublicSettings] = useState(null);
  const [selectedBusinessId, setSelectedBusinessIdState] = useState(() => getSelectedBusinessId() || null);
  const [negocios, setNegocios] = useState([]);
  const [isLoadingNegocios, setIsLoadingNegocios] = useState(false);

  const hasRole = useCallback(
    (roles) => {
      if (!user) return false;
      const ur = String(user.rol ?? user.role ?? '').toLowerCase();
      if (!ur) return false;
      const list = Array.isArray(roles) ? roles : [roles];
      return list.some((r) => String(r).toLowerCase() === ur);
    },
    [user],
  );

  const checkLocalAuth = async () => {
    try {
      // Si no hay token, no tiene sentido pegarle al backend (evita 401 ruidoso).
      const token = getAuthToken();
      if (!token) {
        setUser(null);
        setIsAuthenticated(false);
        return;
      }
      const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
        headers: { ...getAuthHeaders() },
      });
      if (res.ok) {
        const data = await res.json();
        const u = data.user;
        // Si el backend está en modo anónimo, no lo consideramos sesión válida.
        if (u && !u.anonymous) {
          const role = String(u.rol ?? u.role ?? 'cajero').toLowerCase();
          const negocioId = String(u.negocio_id ?? 'negocio_default');
          const persisted = getSelectedBusinessId();
          const initialSelection = (role === 'superadmin')
            ? (persisted || 'all')
            : negocioId;
          setSelectedBusinessId(initialSelection);
          setSelectedBusinessIdState(initialSelection);
          setUser({
            ...u,
            rol: role,
            negocio_id: negocioId,
          });
          setIsAuthenticated(true);
          if (role === 'superadmin') {
            await fetchNegocios();
          } else {
            setNegocios([]);
          }
        } else {
          setUser(null);
          setIsAuthenticated(false);
          setNegocios([]);
        }
      } else {
        // Token inválido/expirado -> limpiar
        if (res.status === 401) clearAuthToken();
        setUser(null);
        setIsAuthenticated(false);
        setNegocios([]);
      }
    } catch (e) {
      console.error('Auth local:', e);
      setUser(null);
      setIsAuthenticated(false);
      setNegocios([]);
    }
  };

  const checkLocalAuthRef = useRef(checkLocalAuth);
  checkLocalAuthRef.current = checkLocalAuth;

  const loginLocal = (token, u) => {
    const role = String(u.rol ?? u.role ?? 'cajero').toLowerCase();
    const negocioId = String(u.negocio_id ?? 'negocio_default');
    const nextSelection = role === 'superadmin'
      ? (getSelectedBusinessId() || 'all')
      : negocioId;
    setSelectedBusinessId(nextSelection);
    setSelectedBusinessIdState(nextSelection);
    setAuthToken(token);
    setUser({
      ...u,
      rol: role,
      negocio_id: negocioId,
    });
    setIsAuthenticated(true);
    if (role === 'superadmin') {
      fetchNegocios();
    } else {
      setNegocios([]);
    }
  };

  const setBusinessScope = (negocioId) => {
    const value = negocioId == null || negocioId === '' ? 'all' : String(negocioId);
    setSelectedBusinessId(value);
    setSelectedBusinessIdState(value);
  };

  const fetchNegocios = useCallback(async () => {
    if (!user) return [];
    const role = String(user.rol ?? user.role ?? '').toLowerCase();
    if (role !== 'superadmin') {
      setNegocios([]);
      return [];
    }
    try {
      setIsLoadingNegocios(true);
      const res = await fetch(`${getApiBaseUrl()}/negocios`, {
        headers: { ...getAuthHeaders() },
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Error al cargar negocios');
      }
      const list = Array.isArray(data) ? data : [];
      setNegocios(list);
      return list;
    } catch (e) {
      console.error('Negocios:', e);
      setNegocios([]);
      return [];
    } finally {
      setIsLoadingNegocios(false);
    }
  }, [user]);

  const checkAuth = async () => {
    if (appParams.appId) {
      // App base44 (no local)
      await checkUserAuth();
      return;
    }
    await checkLocalAuth();
  };

  useEffect(() => {
    checkAppState();
  }, []);

  /** Mantener sesión: revalidar token al volver a la pestaña y periódicamente */
  useEffect(() => {
    if (appParams.appId) return undefined;
    let interval;
    const refresh = () => {
      if (getAuthToken()) checkLocalAuthRef.current();
    };
    const onFocus = () => refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    interval = setInterval(refresh, 4 * 60 * 1000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (interval) clearInterval(interval);
    };
  }, []);

  const checkAppState = async () => {
    try {
      setIsLoadingPublicSettings(true);
      setAuthError(null);

      if (!appParams.appId) {
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(true);
        try {
          await checkLocalAuth();
        } finally {
          setIsLoadingAuth(false);
        }
        return;
      }

      const appClient = createAxiosClient({
        baseURL: `/api/apps/public`,
        headers: {
          'X-App-Id': appParams.appId
        },
        token: appParams.token,
        interceptResponses: true
      });
      
      try {
        const publicSettings = await appClient.get(`/prod/public-settings/by-id/${appParams.appId}`);
        setAppPublicSettings(publicSettings);
        
        if (appParams.token) {
          await checkUserAuth();
        } else {
          setIsLoadingAuth(false);
          setIsAuthenticated(false);
        }
        setIsLoadingPublicSettings(false);
      } catch (appError) {
        console.error('App state check failed:', appError);
        
        if (appError.status === 403 && appError.data?.extra_data?.reason) {
          const reason = appError.data.extra_data.reason;
          if (reason === 'auth_required') {
            setAuthError({
              type: 'auth_required',
              message: 'Authentication required'
            });
          } else if (reason === 'user_not_registered') {
            setAuthError({
              type: 'user_not_registered',
              message: 'User not registered for this app'
            });
          } else {
            setAuthError({
              type: reason,
              message: appError.message
            });
          }
        } else {
          setAuthError({
            type: 'unknown',
            message: appError.message || 'Failed to load app'
          });
        }
        setIsLoadingPublicSettings(false);
        setIsLoadingAuth(false);
      }
    } catch (error) {
      console.error('Unexpected error:', error);
      setAuthError({
        type: 'unknown',
        message: error.message || 'An unexpected error occurred'
      });
      setIsLoadingPublicSettings(false);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      setIsLoadingAuth(true);
      const currentUser = await base44.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsLoadingAuth(false);
      setIsAuthenticated(false);
      
      if (error.status === 401 || error.status === 403) {
        setAuthError({
          type: 'auth_required',
          message: 'Authentication required'
        });
      }
    }
  };

  const logout = (shouldRedirect = true) => {
    if (!appParams.appId) {
      clearAuthToken();
      setSelectedBusinessId(null);
      setSelectedBusinessIdState(null);
      setUser(null);
      setIsAuthenticated(false);
      setNegocios([]);
      if (shouldRedirect) {
        window.location.href = '/Login';
      }
      return;
    }

    setUser(null);
    setIsAuthenticated(false);
    setNegocios([]);
    
    if (shouldRedirect) {
      base44.auth.logout(window.location.href);
    } else {
      base44.auth.logout();
    }
  };

  const navigateToLogin = () => {
    if (!appParams.appId) {
      window.location.href = '/Login';
      return;
    }
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      logout,
      navigateToLogin,
      checkAppState,
      checkAuth,
      hasRole,
      loginLocal,
      selectedBusinessId,
      setBusinessScope,
      negocios,
      isLoadingNegocios,
      fetchNegocios,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
