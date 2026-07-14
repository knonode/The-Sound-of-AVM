import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/main.css'
// Legacy synth styles must come after Tailwind so its element-level rules
// (button, input) win over the preflight reset.
import './legacy/legacy.css'
import ErrorBoundary from './components/ErrorBoundary'

function bootstrap() {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
  )
}

bootstrap();
