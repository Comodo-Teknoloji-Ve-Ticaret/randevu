import { ArrowLeft, KeyRound, Mail, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { apiFetch } from '../infrastructure/api'
import { Button, Field, Input, Modal, useToast } from './index'

/** Kullanıcının kendi şifresini değiştirmesi (sunucu modu). */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ current: '', next: '', again: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mismatch = f.again !== '' && f.next !== f.again
  const save = async () => {
    setBusy(true)
    try {
      await apiFetch('/api/me/password', { body: { currentPassword: f.current, newPassword: f.next } })
      toast('Şifreniz değiştirildi')
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Şifremi değiştir" onClose={onClose} footer={<>
      <Button variant="ghost" onClick={onClose}>Vazgeç</Button>
      <Button variant="primary" icon={ShieldCheck} disabled={busy || !f.current || f.next.length < 8 || f.next !== f.again} onClick={save}>Kaydet</Button>
    </>}>
      <div className="stack" style={{ gap: 12 }}>
        <Field label="Mevcut şifre" error={err}><Input type="password" autoComplete="current-password" autoFocus value={f.current} invalid={!!err} onChange={(e) => { setF({ ...f, current: e.target.value }); setErr(null) }} /></Field>
        <Field label="Yeni şifre" hint="En az 8 karakter."><Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="Yeni şifre (tekrar)" error={mismatch ? 'Şifreler aynı değil' : null}><Input type="password" autoComplete="new-password" value={f.again} invalid={mismatch} onChange={(e) => setF({ ...f, again: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}

/** Giriş ekranında "şifremi unuttum": e-postaya gelen 6 haneli kodla yeni şifre. */
export function ForgotPassword({ initialEmail, onDone }: { initialEmail: string; onDone: (email: string) => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [demoCode, setDemoCode] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const sendCode = (e: FormEvent) => { e.preventDefault(); void run(async () => { const r = await apiFetch<{ demoCode?: string } | undefined>('/api/auth/forgot', { body: { email } }); setDemoCode(r?.demoCode ?? null); setStep('code') }) }
  const reset = (e: FormEvent) => { e.preventDefault(); void run(async () => { await apiFetch('/api/auth/reset', { body: { email, code, newPassword: pw } }); onDone(email) }) }

  return step === 'email' ? (
    <form className="login-form" onSubmit={sendCode}>
      <h2>Şifremi unuttum</h2>
      <p className="muted t-small">E-postanızı yazın; kayıtlıysa şifre sıfırlama kodu gönderelim.</p>
      <Field label="E-posta" error={err}><Input icon={Mail} type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Button variant="primary" size="lg" type="submit" disabled={busy || !email.includes('@')}>{busy ? 'Gönderiliyor…' : 'Kod gönder'}</Button>
      <button type="button" className="login-link" onClick={() => onDone('')}><ArrowLeft size={14} /> Girişe dön</button>
    </form>
  ) : (
    <form className="login-form" onSubmit={reset}>
      <h2>Yeni şifre</h2>
      <p className="muted t-small"><b>{email}</b> kayıtlıysa 6 haneli kod gönderildi (15 dakika geçerli). Gelen kutunuzu ve istenmeyen klasörünü kontrol edin.</p>
      {demoCode && <p className="info-banner t-small">Tarayıcı demosunda e-posta gönderilmez. Kodunuz: <b>{demoCode}</b></p>}
      <Field label="Kod"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
      <Field label="Yeni şifre" hint="En az 8 karakter." error={err}><Input icon={KeyRound} type="password" autoComplete="new-password" value={pw} invalid={!!err} onChange={(e) => { setPw(e.target.value); setErr(null) }} /></Field>
      <Button variant="primary" size="lg" type="submit" disabled={busy || code.length !== 6 || pw.length < 8}>{busy ? 'Kaydediliyor…' : 'Şifremi yenile'}</Button>
      <button type="button" className="login-link" onClick={() => setStep('email')}><ArrowLeft size={14} /> Kodu tekrar gönder</button>
    </form>
  )
}
