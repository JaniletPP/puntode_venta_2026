import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import React, { useEffect } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

/** Rutas accesibles sin sesión (consulta cliente, login): no bloquear por isLoadingAuth */
const PUBLIC_PATH_PREFIXES = ['/consulta-tarjeta', '/perfil-tarjeta', '/Login'];
function isPublicPath(pathname) {
    return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import Login from './pages/Login';
import ConsultaSaldoCliente from './pages/ConsultaSaldoCliente';
import PrivateRoute from '@/lib/PrivateRoute';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

/** Supervisor: landing en Dashboard en lugar de POS */
function LocalHomeRedirect({ children }) {
  const { hasRole, isLoadingAuth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (isLoadingAuth) return;
    if (location.pathname !== '/') return;
    if (hasRole(['supervisor']) && !hasRole(['admin'])) {
      navigate('/Dashboard', { replace: true });
    }
  }, [isLoadingAuth, location.pathname, hasRole, navigate]);
  return children;
}

const AuthenticatedApp = () => {
  const location = useLocation();
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const allowPublicWhileLoading = isPublicPath(location.pathname);

  useEffect(() => {
    if (authError?.type === 'auth_required') {
      navigateToLogin();
    }
  }, [authError, navigateToLogin]);

  // Spinner solo para rutas protegidas; consulta de saldo y login cargan al instante
  if (!allowPublicWhileLoading && (isLoadingPublicSettings || isLoadingAuth)) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirección disparada en useEffect para evitar side-effects durante render
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/consulta-tarjeta" element={<ConsultaSaldoCliente />} />
      <Route path="/perfil-tarjeta" element={<Navigate to="/consulta-tarjeta" replace />} />
      <Route path="/Login" element={<Login />} />
      <Route path="/" element={
        <PrivateRoute>
          <LayoutWrapper currentPageName={mainPageKey}>
            <LocalHomeRedirect>
              <MainPage />
            </LocalHomeRedirect>
          </LayoutWrapper>
        </PrivateRoute>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <PrivateRoute>
              <LayoutWrapper currentPageName={path}>
                <Page />
              </LayoutWrapper>
            </PrivateRoute>
          }
        />
      ))}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
