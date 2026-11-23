import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import App from './App'
import { shortLinkRedirect } from './domain/links'
import { apiMode } from './infrastructure/api'

// Kısa randevu linki (alanadi/studio-lara) → randevu sayfası. Sunucu (Caddy) da yönlendirir; bu, diğer ortamlar için yedek.
if (apiMode) {
  const to = shortLinkRedirect(location.pathname, location.hash)
  if (to) history.replaceState(null, '', to)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
