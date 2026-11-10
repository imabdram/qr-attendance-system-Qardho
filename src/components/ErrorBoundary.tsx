import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Last line of defence: a render error should show a way out instead of a blank page.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Unhandled UI error:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="login-wrap">
        <div className="login-card" style={{ maxWidth: 460 }}>
          <p className="eyebrow" style={{ color: '#dc2626' }}>
            SOMETHING WENT WRONG
          </p>
          <h1>This page hit an error</h1>
          <p className="muted">
            Reload to continue. If it happens again, sign out and sign back in.
          </p>
          <pre className="error-detail">{this.state.error.message}</pre>
          <button className="primary full" onClick={() => window.location.reload()}>
            Reload the app
          </button>
        </div>
      </main>
    );
  }
}
