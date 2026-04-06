import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

/**
 * Rutas que requieren sesión válida (JWT en localStorage + usuario desde /auth/me).
 * Si no hay token o el servidor rechaza la sesión, redirige a /Login.
 */
export default function PrivateRoute({ children }) {
  const location = useLocation();
  const { isAuthenticated, isLoadingAuth, user } = useAuth();

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/Login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

