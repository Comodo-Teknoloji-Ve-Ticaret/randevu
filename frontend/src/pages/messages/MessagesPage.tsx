import { BellRing, Cake, Check, Info, MessageCircle, MessageSquareText, Send, SkipForward, Smartphone } from 'lucide-react'
import { useState } from 'react'
import { messageService } from '../../application/messageService'
import { formatPhone } from '../../domain/phone'
import { renderTemplate, TEMPLATE_VARS } from '../../domain/template'
import { addDays, formatDate, todayIstanbul, toHHMM } from '../../domain/time'
import type { Appointment, MessageKind, MessageLog, MessageTemplate } from '../../domain/types'
import { useSession } from '../../app/session'
import { useRepos } from '../../infrastructure'
import { Avatar, Badge, Button, EmptyState, Field, Kpi, Modal, PageHeader, Switch, Tabs, Textarea, useToast } from '../../ui'
import './messages.css'

const KIND_LABEL: Record<MessageKind, string> = { confirm: 'Onay', reminder: 'Hatırlatma', cancel: 'İptal', birthday: 'Doğum günü', winback: 'Geri kazanım' }

const STATUS: Record<MessageLog['status'], { label: string; tone: 'info' | 'success' | 'danger' | 'neutral' }> = {
  simulated: { label: 'SMS (demo)', tone: 'info' },
  queued: { label: 'SMS sırada', tone: 'neutral' },
  sent: { label: 'SMS iletildi', tone: 'success' },
  failed: { label: 'SMS iletilemedi', tone: 'danger' },
  opened: { label: 'WhatsApp açıldı', tone: 'success' },
}

export default function MessagesPage() {
  const [tab, setTab] = useState<'today' | 'templates' | 'log'>('today')
  const repos = useRepos()
  const ms = messageService(repos)
  const due = ms.dueReminders()
  return (
    <div className="page">
      <PageHeader title="Mesajlar" subtitle="Hatırlatma, doğum günü ve bildirim mesajları" />
      <div className="info-banner"><Info /><span>Demo modunda SMS gönderimi <b>simüle edilir</b>; WhatsApp butonları gerçek WhatsApp'ı hazır mesajla açar. Gerçek SMS için sağlayıcı (Netgsm, İleti Merkezi vb.) backend aşamasında bağlanacak.</span></div>
      <Tabs value={tab} onChange={setTab} options={[{ value: 'today', label: 'Gönderilecekler', count: due.length }, { value: 'templates', label: 'Şablonlar' }, { value: 'log', label: 'Gönderim kaydı' }]} />
      <div style={{ marginTop: 16 }}>
        {tab === 'today' && <TodayTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'log' && <LogTab />}
      </div>
    </div>
  )
}

function TodayTab() {
  const repos = useRepos()
  const toast = useToast()
  const ms = messageService(repos)
  const today = todayIstanbul()
  const due = ms.dueReminders()
  const tomorrowCount = repos.appointments.list({ date: addDays(today, 1) }).filter((a) => a.customerId && !['cancelled', 'no_show'].includes(a.status)).length
  const bdays = ms.birthdaysToday()
  const sentToday = repos.messages.list().filter((m) => m.at.slice(0, 10) === today).length
  const [waQueue, setWaQueue] = useState<Appointment[] | null>(null)
  const openWa = (kind: MessageKind, target: { appointmentId?: string; customerId?: string }) => {
    const r = ms.send(kind, target, 'whatsapp')
    if (r.url) window.open(r.url, '_blank', 'noopener')
  }
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="kpis">
        <Kpi icon={BellRing} label="Yarın hatırlatılacak" value={due.length} />
        <Kpi icon={Cake} label="Bugün doğum günü" value={bdays.length} tone="#e84393" />
        <Kpi icon={Send} label="Bugün gönderilen" value={sentToday} tone="var(--success)" />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Yarınki randevular · {formatDate(addDays(today, 1), { weekday: true })}</h3>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button icon={MessageCircle} disabled={!due.length} onClick={() => setWaQueue(due)}>Tümüne WhatsApp</Button>
            <Button variant="primary" icon={Smartphone} disabled={!due.length} onClick={() => toast(`${ms.remindAll()} hatırlatma SMS'i gönderildi (simülasyon)`)}>Tümüne SMS gönder</Button>
          </div>
        </div>
        <div className="list" style={{ marginTop: 8 }}>
          {due.length === 0 && (tomorrowCount === 0
            ? <EmptyState icon={BellRing} title="Yarın için hatırlatılacak randevu yok" text="Yarın randevu bulunmuyor ya da salon kapalı." />
            : <EmptyState icon={BellRing} title="Hatırlatılacak randevu kalmadı" text="İleti izni olan tüm müşterilere hatırlatma gönderildi." />)}
          {due.map((a) => {
            const c = repos.customers.get(a.customerId!)!
            return (
              <div key={a.id} className="list-item">
                <Avatar name={c.name} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t-strong">{c.name}</div>
                  <div className="t-small muted">{toHHMM(a.start)} · {a.items.map((i) => repos.services.get(i.serviceId)?.name).join(', ')} · {repos.staff.get(a.staffId)?.name.split(' ')[0]}</div>
                </div>
                <Button size="sm" icon={MessageCircle} onClick={() => openWa('reminder', { appointmentId: a.id })}>WhatsApp</Button>
                <Button size="sm" icon={Smartphone} onClick={() => { ms.send('reminder', { appointmentId: a.id }, 'sms'); toast(`${c.name.split(' ')[0]}: SMS gönderildi`) }}>SMS</Button>
              </div>
            )
          })}
        </div>
      </div>
      {waQueue && <WhatsAppQueue queue={waQueue} onClose={(n) => { setWaQueue(null); if (n) toast(`${n} müşteriye WhatsApp hatırlatması açıldı`) }} />}
      <div className="card">
        <div className="card-head"><h3>Bugün doğum günü olanlar 🎉</h3></div>
        <div className="list" style={{ marginTop: 8 }}>
          {bdays.length === 0 && <p className="muted" style={{ padding: 16 }}>Bugün doğum günü olan müşteri yok.</p>}
          {bdays.map((c) => (
            <div key={c.id} className="list-item">
              <Avatar name={c.name} size={34} />
              <div style={{ flex: 1 }}><div className="t-strong">{c.name}</div><div className="t-small muted">{formatPhone(c.phone)}</div></div>
              <Button size="sm" icon={MessageCircle} onClick={() => openWa('birthday', { customerId: c.id })}>Kutla</Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Tarayıcılar tek tıkla birden çok pencere açmayı engeller; bu yüzden her müşteri için ayrı (bireysel) sohbet sırayla açılır. */
function WhatsAppQueue({ queue, onClose }: { queue: Appointment[]; onClose: (sent: number) => void }) {
  const repos = useRepos()
  const ms = messageService(repos)
  const [i, setI] = useState(0)
  const [sent, setSent] = useState(0)
  const a = queue[i]
  const done = i >= queue.length
  const p = a ? ms.preview('reminder', { appointmentId: a.id }) : null
  const next = () => setI((x) => x + 1)
  const send = () => {
    const r = ms.send('reminder', { appointmentId: a.id }, 'whatsapp')
    if (r.url) window.open(r.url, '_blank', 'noopener')
    setSent((n) => n + 1)
    next()
  }
  return (
    <Modal title="WhatsApp ile tek tek gönder" onClose={() => onClose(sent)} footer={done
      ? <Button variant="primary" icon={Check} onClick={() => onClose(sent)}>Bitti</Button>
      : <><Button variant="ghost" onClick={() => onClose(sent)}>Durdur</Button><Button icon={SkipForward} onClick={next}>Atla</Button><Button variant="primary" icon={MessageCircle} onClick={send}>WhatsApp'ta aç</Button></>}>
      <div className="wa-progress"><span style={{ width: `${(Math.min(i, queue.length) / queue.length) * 100}%` }} /></div>
      {done ? (
        <EmptyState icon={Check} title={`${sent} / ${queue.length} müşteriye gönderildi`} text="Her mesaj müşteriyle ayrı sohbette açıldı; grup oluşturulmadı." />
      ) : p && (
        <div className="stack" style={{ gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <Avatar name={p.customer.name} size={38} />
              <div><div className="t-strong">{p.customer.name}</div><div className="t-small muted">{formatPhone(p.customer.phone)} · {toHHMM(a.start)}</div></div>
            </div>
            <Badge tone="info">{i + 1} / {queue.length}</Badge>
          </div>
          <div className="phone-preview"><div className="bubble">{p.body}</div><span>Mesaj WhatsApp'ta hazır açılır; göndermek için WhatsApp'ta gönder tuşuna basın.</span></div>
        </div>
      )}
    </Modal>
  )
}

function TemplatesTab() {
  const repos = useRepos()
  const { tenant } = useSession()
  const list = repos.templates.list()
  const [sel, setSel] = useState<MessageTemplate | null>(list[0] ?? null)
  const [body, setBody] = useState(list[0]?.body ?? '')
  const toast = useToast()
  const sample = { musteri: 'Elif', salon: tenant?.name ?? 'Salon', tarih: formatDate(addDays(todayIstanbul(), 1), { weekday: true }), saat: '14:30', hizmet: 'Dip Boya', personel: 'Ayşe' }
  const pick = (t: MessageTemplate) => { setSel(t); setBody(t.body) }
  return (
    <div className="tpl-layout">
      <div className="card list">
        {list.map((t) => (
          <button key={t.id} className={`tpl-item ${sel?.id === t.id ? 'on' : ''}`} onClick={() => pick(t)}>
            <MessageSquareText />
            <div><b>{t.name}</b><span>{KIND_LABEL[t.kind]}{t.hoursBefore ? ` · ${t.hoursBefore} saat önce` : ''}</span></div>
            {t.enabled ? <Badge tone="success">Açık</Badge> : <Badge>Kapalı</Badge>}
          </button>
        ))}
      </div>
      {sel && (
        <div className="card card-pad stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ fontSize: 16 }}>{sel.name}</h3>
            <div className="row"><span className="t-small muted">Otomatik gönderim</span><Switch on={sel.enabled} onChange={(v) => { const t = repos.templates.upsert({ ...sel, enabled: v }); setSel(t) }} /></div>
          </div>
          <Field label="Mesaj metni" hint={`${body.length} karakter · ${Math.max(1, Math.ceil(body.length / 155))} SMS`}>
            <Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="var-chips">
            {TEMPLATE_VARS.map((v) => <button key={v.key} className="chip" onClick={() => setBody((b) => `${b}{${v.key}}`)}>+ {v.label}</button>)}
          </div>
          <div className="phone-preview">
            <div className="bubble">{renderTemplate(body, sample)}</div>
            <span>Önizleme</span>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="primary" disabled={body === sel.body} onClick={() => { setSel(repos.templates.upsert({ ...sel, body })); toast('Şablon kaydedildi') }}>Kaydet</Button>
          </div>
        </div>
      )}
    </div>
  )
}

function LogTab() {
  const repos = useRepos()
  const logs = repos.messages.list().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100)
  return (
    <div className="card">
      {logs.length === 0 && <EmptyState icon={Send} title="Henüz mesaj gönderilmedi" />}
      <div className="list">
        {logs.map((m) => {
          const c = m.customerId ? repos.customers.get(m.customerId) : undefined
          return (
            <div key={m.id} className="list-item" style={{ alignItems: 'flex-start' }}>
              <span className={`log-ch ${m.channel}`}>{m.channel === 'sms' ? <Smartphone /> : <MessageCircle />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}><b>{c?.name ?? formatPhone(m.to)}</b><Badge>{KIND_LABEL[m.kind]}</Badge></div>
                <p className="t-small muted" style={{ marginTop: 2 }}>{m.body}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="t-small muted">{formatDate(m.at.slice(0, 10))} {m.at.slice(11, 16)}</div>
                <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                {m.status === 'failed' && m.error && <span className="t-small" style={{ color: 'var(--danger)' }}>{m.error}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
