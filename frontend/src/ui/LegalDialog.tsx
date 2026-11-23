import { Copy } from 'lucide-react'
import { legalPlainText, legalTitle, marketingConsentText, privacyNotice, type LegalDoc, type SalonInfo } from '../domain/legal'
import { Button, Modal, useToast } from './index'

export type { LegalDoc }

/** Aydınlatma / açık rıza metnini salon bilgileriyle gösterir; istenirse kopyalama düğmesi. */
export function LegalDialog({ doc, salon, onClose, copyable }: { doc: LegalDoc; salon: SalonInfo; onClose: () => void; copyable?: boolean }) {
  const toast = useToast()
  return (
    <Modal title={legalTitle(doc)} onClose={onClose} footer={<>
      {copyable && <Button icon={Copy} onClick={() => { void navigator.clipboard?.writeText(legalPlainText(doc, salon)); toast('Metin kopyalandı') }}>Kopyala</Button>}
      <Button variant="primary" onClick={onClose}>Tamam</Button>
    </>}>
      <div className="legal-text">
        {doc === 'privacy'
          ? privacyNotice(salon).map((s) => <section key={s.title}><h4>{s.title}</h4><p>{s.body}</p></section>)
          : <p>{marketingConsentText(salon)}</p>}
      </div>
    </Modal>
  )
}
