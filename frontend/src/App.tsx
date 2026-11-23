import { useEffect } from 'react'
import { HashRouter } from 'react-router-dom'
import { AppRoutes } from './app/routes'
import { SessionProvider } from './app/session'
import { getStore, onStoreError, StoreProvider } from './infrastructure'
import { FeedbackProvider, useToast } from './ui'

const store = getStore()

function StoreWarnings() {
  const toast = useToast()
  useEffect(() => {
    if (store.recovered) toast('Kayıtlı veri okunamadı; demo verisi yeniden yüklendi.', 'info')
    const un = store.subscribe(() => {
      if (store.persistError) toast('Tarayıcı depolama alanı dolu; değişiklikler kaydedilemiyor.', 'error')
    })
    // Sunucu modunda: reddedilen değişiklik geri alınır, nedeni gösterilir.
    const unErr = onStoreError((message) => toast(`Kaydedilmedi: ${message}`, 'error'))
    return () => { un(); unErr() }
  }, [toast])
  return null
}

export default function App() {
  return (
    <StoreProvider store={store}>
      <FeedbackProvider>
        <SessionProvider>
          <HashRouter>
            <StoreWarnings />
            <AppRoutes />
          </HashRouter>
        </SessionProvider>
      </FeedbackProvider>
    </StoreProvider>
  )
}
