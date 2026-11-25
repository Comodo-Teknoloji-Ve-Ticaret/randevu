import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { markSeen, type TourStep } from './tourSteps'
import './tour.css'

interface Box { top: number; left: number; width: number; height: number }
const PAD = 6, GAP = 14, MARGIN = 12

function measure(selector?: string): Box | null {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return null
  // Çerçeve ekran kenarına taşmasın (ör. telefonda alt menünün en sağdaki öğesi)
  const left = Math.max(2, r.left - PAD), top = Math.max(2, r.top - PAD)
  const right = Math.min(window.innerWidth - 2, r.right + PAD), bottom = Math.min(window.innerHeight - 2, r.bottom + PAD)
  return { top, left, width: right - left, height: bottom - top }
}

/** Kartı vurgunun sağına, olmazsa altına/üstüne yerleştirir; her durumda ekran içinde kalır. */
function place(spot: Box | null, card: { w: number; h: number }) {
  const vw = window.innerWidth, vh = window.innerHeight
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - card.w - MARGIN)
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - card.h - MARGIN)
  if (!spot) return { left: clampX((vw - card.w) / 2), top: clampY((vh - card.h) / 2) }
  if (spot.left + spot.width + GAP + card.w + MARGIN <= vw) return { left: spot.left + spot.width + GAP, top: clampY(spot.top + spot.height / 2 - card.h / 2) }
  const below = spot.top + spot.height + GAP
  if (below + card.h + MARGIN <= vh) return { left: clampX(spot.left + spot.width / 2 - card.w / 2), top: below }
  return { left: clampX(spot.left + spot.width / 2 - card.w / 2), top: clampY(spot.top - GAP - card.h) }
}

export function Tour({ steps, userId, onClose }: { steps: TourStep[]; userId: string; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [spot, setSpot] = useState<Box | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const step = steps[Math.min(i, steps.length - 1)]
  const last = i >= steps.length - 1

  const close = useCallback(() => { markSeen(userId); onClose() }, [userId, onClose])
  const next = useCallback(() => (last ? close() : setI((x) => x + 1)), [last, close])
  const prev = useCallback(() => setI((x) => Math.max(0, x - 1)), [])

  // Vurgu ve kart konumu: adım değişince, pencere boyutu değişince ya da sayfa kayınca yeniden hesaplanır.
  useLayoutEffect(() => {
    const el = step.target ? document.querySelector(step.target) : null
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const update = () => {
      const s = measure(step.target)
      setSpot(s)
      const c = cardRef.current
      if (c) setPos(place(s, { w: c.offsetWidth, h: c.offsetHeight }))
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, next, prev])

  useEffect(() => { cardRef.current?.querySelector<HTMLButtonElement>('.tour-next')?.focus() }, [i])

  return (
    <div className="tour" role="presentation">
      {/* Tıklamalar arkadaki sayfaya geçmez; vurgu yoksa ekran düz karartılır */}
      <div className={spot ? 'tour-block' : 'tour-block dim'} onClick={(e) => e.stopPropagation()} />
      {spot && <div className="tour-spot" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
      >
        <button type="button" className="tour-x" onClick={close} aria-label="Tanıtımı kapat"><X /></button>
        <span className="tour-count">{i + 1} / {steps.length}</span>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((s, k) => <span key={s.id} className={k === i ? 'on' : k < i ? 'past' : ''} />)}
        </div>
        <div className="tour-actions">
          {!last && <button type="button" className="btn btn-ghost btn-sm tour-skip" onClick={close}>Atla</button>}
          <span className="spacer" />
          {i > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={prev}><ChevronLeft />Geri</button>}
          <button type="button" className="btn btn-primary btn-sm tour-next" onClick={next}>
            {last ? 'Bitir' : 'İleri'}{!last && <ChevronRight />}
          </button>
        </div>
      </div>
    </div>
  )
}
