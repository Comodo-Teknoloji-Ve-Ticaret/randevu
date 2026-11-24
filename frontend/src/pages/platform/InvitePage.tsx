import { useParams } from 'react-router-dom'
import ApiInvite from './ApiInvite'

/** Davet: salon sahibi ad, telefon, e-posta ve şifresini belirler (tarayıcı demosunda giriş bilgisi tarayıcıda tutulur). */
export default function InvitePage() {
  const { token = '' } = useParams()
  return <ApiInvite token={token} />
}
