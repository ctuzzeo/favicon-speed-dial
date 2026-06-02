import {
  Component,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Styles are inline on purpose: the boundary must render legibly even when the
// failure is in global CSS, the theme, or the wallpaper layer.
const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  background: "rgba(0, 0, 0, 0.55)",
  zIndex: 2147483647,
};

const cardStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  maxWidth: "440px",
  padding: "28px",
  borderRadius: "12px",
  background: "#1f1f1f",
  color: "#f5f5f5",
  fontFamily: "system-ui, -apple-system, sans-serif",
  textAlign: "center",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)",
};

const buttonStyle: CSSProperties = {
  appearance: "none",
  border: "none",
  borderRadius: "8px",
  padding: "10px 18px",
  fontSize: "14px",
  fontWeight: 600,
  cursor: "pointer",
  background: "#4f8cff",
  color: "#fff",
  textDecoration: "none",
};

const secondaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "transparent",
  border: "1px solid rgba(255, 255, 255, 0.3)",
};

/**
 * Catches render-time errors so a single throwing component cannot leave the
 * new-tab page (or settings page) blank with no way to recover.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled error in UI:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" style={overlayStyle}>
        <div style={cardStyle}>
          <h1 style={{ margin: "0 0 12px", fontSize: "20px" }}>
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 20px", lineHeight: 1.5, opacity: 0.85 }}>
            Favicon Speed Dial hit an unexpected error and couldn&rsquo;t render
            this page. Reloading usually fixes it.
          </p>
          <div
            style={{
              display: "flex",
              gap: "12px",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              style={buttonStyle}
              onClick={() => location.reload()}
            >
              Reload
            </button>
            <a href="settings.html" style={secondaryButtonStyle}>
              Open settings
            </a>
          </div>
          {error.message && (
            <pre
              style={{
                margin: "20px 0 0",
                padding: "12px",
                borderRadius: "8px",
                background: "rgba(0, 0, 0, 0.35)",
                color: "#ffb4b4",
                fontSize: "12px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                textAlign: "left",
              }}
            >
              {error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
