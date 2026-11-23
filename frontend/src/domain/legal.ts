import { formatPhone } from './phone'

/**
 * KVKK metin TASLAKLARI (6698 sayılı Kanun m.10 aydınlatma, m.5 açık rıza; 6563 sayılı Kanun ticari ileti).
 * Veri sorumlusu salondur; Comodo yazılım/barındırma hizmeti veren veri işleyendir.
 * Yayına almadan önce bir hukukçuya onaylatılmalıdır.
 */
export interface SalonInfo { name: string; address: string; phone: string }

export interface LegalSection { title: string; body: string }

const contact = (s: SalonInfo) => [s.address, s.phone ? formatPhone(s.phone) : ''].filter(Boolean).join(' · ')

export function privacyNotice(s: SalonInfo): LegalSection[] {
  return [
    {
      title: 'Veri sorumlusu',
      body: `Kişisel verileriniz, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") kapsamında veri sorumlusu sıfatıyla ${s.name} (${contact(s) || 'iletişim bilgileri salonda'}) tarafından işlenmektedir.`,
    },
    {
      title: 'Hangi verileri işliyoruz?',
      body: 'Kimlik ve iletişim (ad soyad, cep telefonu); randevu bilgileri (tarih, saat, hizmet, personel, notunuz); hizmet geçmişi ve size özel bakım notları (ör. boya formülü, hassasiyetler); ödeme ve adisyon kayıtları; ileti tercihleriniz.',
    },
    {
      title: 'Hangi amaçlarla işliyoruz?',
      body: 'Randevunuzun oluşturulması, onaylanması, hatırlatılması, değiştirilmesi ve iptali; hizmetin size uygun şekilde sunulması; ödeme, muhasebe ve fatura işlemleri; yasal yükümlülüklerin yerine getirilmesi; talepleriniz ve şikâyetlerinizin yanıtlanması. Açık rıza vermeniz hâlinde kampanya ve fırsatlardan haberdar edilmeniz.',
    },
    {
      title: 'Hukuki sebep',
      body: 'Verileriniz KVKK m.5/2 uyarınca bir sözleşmenin kurulması veya ifası (randevu ve hizmet), hukuki yükümlülüklerimizin yerine getirilmesi ve temel hak ve özgürlüklerinize zarar vermemek kaydıyla meşru menfaatimiz (randevu hatırlatması, hizmet kalitesi) sebeplerine dayanılarak işlenir. Randevu almak için açık rıza vermeniz gerekmez. Kampanya ve tanıtım mesajları yalnızca KVKK m.5/1 ve 6563 sayılı Kanun uyarınca açık rızanızla gönderilir.',
    },
    {
      title: 'Kimlere aktarılır?',
      body: 'Verileriniz yalnızca yukarıdaki amaçlar için ve gerektiği ölçüde; randevu ve salon yönetimi yazılımını sağlayan ve verileri barındıran hizmet sağlayıcımıza (Comodo Teknoloji ve Ticaret, veri işleyen sıfatıyla), SMS/ileti hizmet sağlayıcılarına ve talep hâlinde yetkili kamu kurum ve kuruluşlarına aktarılabilir. Verileriniz yurt dışına aktarılmaz.',
    },
    {
      title: 'Nasıl toplanır?',
      body: 'Online randevu formu, telefon, WhatsApp ve salonda yüz yüze iletişim yoluyla, elektronik ve fiziki ortamda toplanır.',
    },
    {
      title: 'Ne kadar süre saklanır?',
      body: 'Hizmet ilişkisi süresince ve ilgili mevzuatta öngörülen saklama süreleri boyunca saklanır; süre sonunda silinir, yok edilir veya anonim hâle getirilir.',
    },
    {
      title: 'Haklarınız',
      body: `KVKK'nın 11. maddesi uyarınca; verilerinizin işlenip işlenmediğini öğrenme, işlenmişse bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme, aktarıldığı üçüncü kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, şartları oluşmuşsa silinmesini veya yok edilmesini ve bu işlemlerin aktarıldığı kişilere bildirilmesini isteme, otomatik sistemlerle analiz sonucu aleyhinize bir sonuç çıkmasına itiraz etme ve kanuna aykırı işleme sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme haklarına sahipsiniz. Başvurularınızı ${s.name} adresine yazılı olarak veya kayıtlı iletişim kanalları üzerinden iletebilirsiniz; başvurunuz en geç 30 gün içinde ücretsiz sonuçlandırılır.`,
    },
  ]
}

export function marketingConsentText(s: SalonInfo): string {
  return `${s.name} tarafından kampanya, indirim, fırsat, doğum günü kutlaması ve yeni hizmet duyurularının cep telefonuma SMS ve WhatsApp yoluyla gönderilmesine ve bu amaçla ad soyad ve telefon bilgimin işlenmesine açık rıza veriyorum. Bu izin isteğe bağlıdır; vermemeniz randevu almanızı etkilemez. İzninizi dilediğiniz zaman, ücretsiz olarak, salona bildirerek veya mesajlardaki ret yöntemini kullanarak geri alabilirsiniz.`
}

export type LegalDoc = 'privacy' | 'consent'

export const legalTitle = (doc: LegalDoc) => (doc === 'privacy' ? 'Kişisel Verilerin Korunması Aydınlatma Metni' : 'Ticari Elektronik İleti Açık Rıza Metni')

/** Kopyalanabilir düz metin (WhatsApp/çıktı için). */
export function legalPlainText(doc: LegalDoc, salon: SalonInfo): string {
  return doc === 'privacy'
    ? [legalTitle(doc), ...privacyNotice(salon).map((s) => `${s.title}\n${s.body}`)].join('\n\n')
    : `${legalTitle(doc)}\n\n${marketingConsentText(salon)}`
}
