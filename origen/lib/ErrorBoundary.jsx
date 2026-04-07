import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '', stack: '', componentStack: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: String(error?.message || error || '') };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary:', error, errorInfo);
    this.setState({
      stack: String(error?.stack || ''),
      componentStack: String(errorInfo?.componentStack || ''),
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const label = this.props.label ? String(this.props.label) : '';
    const details = [
      label ? `label: ${label}` : null,
      this.state.componentStack ? `componentStack:\n${this.state.componentStack}` : null,
      this.state.stack ? `stack:\n${this.state.stack}` : null,
    ].filter(Boolean).join('\n\n');

    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Ocurrio un error en la interfaz</h1>
          <p className="mt-2 text-sm text-slate-600">
            La aplicacion detecto un fallo inesperado y se detuvo para evitar datos inconsistentes.
          </p>
          {this.state.message ? (
            <p className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {this.state.message}
            </p>
          ) : null}
          {details ? (
            <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-snug text-slate-700 whitespace-pre-wrap">
              {details}
            </pre>
          ) : null}
          <button
            type="button"
            onClick={this.handleReload}
            className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
          >
            Recargar aplicacion
          </button>
        </div>
      </div>
    );
  }
}
