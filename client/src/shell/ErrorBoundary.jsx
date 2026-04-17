import { Component } from 'react';

// Catches any render error in the tree below and shows a readable fallback
// instead of an invisible blank screen.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        dir="rtl"
        style={{
          minHeight: '100vh',
          padding: '2rem',
          fontFamily: 'system-ui, sans-serif',
          background: '#fff',
          color: '#111',
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '.5rem' }}>
          שגיאת תצוגה
        </h1>
        <div style={{ color: '#6b7280', marginBottom: '1rem', fontSize: '0.9rem' }}>
          התרחשה שגיאה ברינדור האפליקציה.
        </div>
        <pre
          style={{
            background: '#f3f4f6',
            padding: '1rem',
            borderRadius: 6,
            fontSize: '0.8rem',
            direction: 'ltr',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
          }}
        >
          {String(this.state.error?.stack || this.state.error)}
        </pre>
      </div>
    );
  }
}
