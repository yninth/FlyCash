import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || '应用程序发生意外错误',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B1120] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-lg border border-rose-800/70 bg-[#0F172A] p-6 space-y-4">
            <h1 className="text-lg font-semibold text-rose-400">页面运行遇到异常</h1>
            <p className="text-xs text-slate-300 leading-relaxed break-all font-mono">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors"
            >
              重新加载驾驶舱
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
