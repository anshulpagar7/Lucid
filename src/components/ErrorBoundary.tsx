import { Component, type ReactNode } from "react";

/** Keeps one broken view from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[lucid] view crashed", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel p-8 text-center lg:col-span-12">
        <div className="label mb-2">Something went wrong in this view</div>
        <p className="mx-auto max-w-lg text-[13px] text-muted">{this.state.error.message}</p>
        <p className="mt-1 text-[12px] text-faint">Your recordings and study data are safe — they're stored separately on this device.</p>
        <button className="btn btn-primary mt-5" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
