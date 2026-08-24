import { Component, type ErrorInfo, type ReactNode } from "react";

interface RuntimeErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  title?: string;
}

interface RuntimeErrorBoundaryState {
  error: Error | null;
}

export class RuntimeErrorBoundary extends Component<
  RuntimeErrorBoundaryProps,
  RuntimeErrorBoundaryState
> {
  state: RuntimeErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RuntimeErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("GloamCore renderer failure", error, info.componentStack);
  }

  componentDidUpdate(previous: RuntimeErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="runtime-error" role="alert" aria-live="assertive">
        <strong>{this.props.title || "This part of GloamCore could not load"}</strong>
        <p>
          A workspace file may have failed to load. Reload the application to
          retry from a clean state.
        </p>
        <button
          type="button"
          className="is-primary"
          onClick={() => window.location.reload()}
        >
          Reload application
        </button>
      </section>
    );
  }
}
