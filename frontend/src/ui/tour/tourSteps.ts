import type { Role } from '../../domain/types'

export interface TourStep {
  id: string
  title: string
  text: string
  /** Vurgulanacak öğenin seçicisi; yoksa adım ekranın ortasında gösterilir. */
  target?: string
}

export interface TourInput {
  role: Role
  name: string
  /** Kullanıcının menüde gördüğü sayfalar (sırasıyla). */
  nav: string[]
  /** Telefondaki alt menüde doğrudan duran sayfalar. */
  mobileNav: string[]
  hasBranches: boolean
  mobile: boolean
}

const PAGES: Record<string, { title: string; text: string }> = {
  '/takvim': {
    title: 'Randevu takvimi',
    text: 'Günlük ve haftalık takviminiz. "Randevu" düğmesiyle ya da boş bir saate tıklayarak randevu ekleyin; randevuyu sürükleyerek taşıyın, alt kenarından çekerek süresini uzatın. Online gelen ve onay bekleyen randevuların sayısı menüde görünür.',
  },
  '/musteriler': {
    title: 'Müşteriler',
    text: 'Her müşterinin geçmiş randevuları, notları, harcaması, borcu ve boya formülleri tek kartta. Aradığınız müşteriyi adından ya da telefonundan bulun.',
  },
  '/kasa': {
    title: 'Kasa',
    text: 'Ödemeleri alın, açık hesapları ve borç tahsilatlarını takip edin, giderleri girin. Gün sonunda kasayı kapatarak günü kayda geçirin.',
  },
  '/hizmetler': {
    title: 'Hizmetler',
    text: 'Hizmetlerinizi, sürelerini ve fiyatlarını düzenleyin. Hangi hizmetlerin online randevuda görüneceğini buradan seçersiniz.',
  },
  '/personel': {
    title: 'Personel',
    text: 'Çalışanlarınız, çalışma saatleri, yapabildikleri hizmetler ve prim oranları. Performanslarını da buradan izlersiniz.',
  },
  '/stok': {
    title: 'Stok',
    text: 'Satış ve salon içi kullanım ürünleriniz. Kritik seviyenin altına düşen ürünler menüde sayıyla uyarır.',
  },
  '/paketler': {
    title: 'Paketler',
    text: 'Seans paketleri tanımlayıp satın (ör. 5+1 fön). Müşterinin kalan seansları kendiliğinden takip edilir.',
  },
  '/mesajlar': {
    title: 'Mesajlar',
    text: 'Yarınki randevular için müşterilere tek dokunuşla WhatsApp hatırlatması gönderin. Mesaj şablonlarınızı da buradan düzenlersiniz.',
  },
  '/raporlar': {
    title: 'Raporlar',
    text: 'Ciro, doluluk, en çok satan hizmetler ve personel primleri. Tarih aralığını değiştirerek dönemleri karşılaştırın.',
  },
  '/primlerim': {
    title: 'Primlerim',
    text: 'Yaptığınız işler ve hak ettiğiniz primler burada.',
  },
  '/ayarlar': {
    title: 'Ayarlar',
    text: 'Salon bilgileri, şubeler, çalışma saatleri, online randevu bağlantınız (karekoduyla birlikte) ve kullanıcılarınızın yetkileri.',
  },
  '/platform': {
    title: 'İşletmeler',
    text: 'Tüm salonlar, lisans durumları ve aylık gelir. "Yeni işletme" ile salon açın, "Davet" ile salon sahibine kurulum bağlantısı gönderin, "Uzat" ile lisansı uzatın. "Comodo yöneticileri" ekip arkadaşlarınızın hesaplarıdır.',
  },
}

export function buildTourSteps({ role, name, nav, mobileNav, hasBranches, mobile }: TourInput): TourStep[] {
  const first = name.split(' ')[0]
  const steps: TourStep[] = [{
    id: 'welcome',
    title: `Hoş geldiniz, ${first}!`,
    text: 'RandevunHazır\'da nereden ne yapılacağını kısaca gösterelim. "İleri" ile ilerleyin; istediğiniz an "Atla" diyebilirsiniz. Bu tanıtımı sonra kullanıcı menünüzden yeniden açabilirsiniz.',
  }]
  for (const path of nav) {
    const page = PAGES[path]
    if (!page) continue
    if (!mobile) { steps.push({ id: path, ...page, target: `.sidebar [data-tour="${path}"]` }); continue }
    const direct = mobileNav.includes(path)
    steps.push({
      id: path,
      title: page.title,
      text: direct ? page.text : `${page.text} Telefonda bu sayfa alttaki "Daha fazla" menüsünde.`,
      target: `.bottom-nav [data-tour="${direct ? path : '/daha'}"]`,
    })
  }
  if (hasBranches) steps.push({
    id: 'branch',
    title: 'Şube seçimi',
    text: 'Birden fazla şubeniz varsa çalıştığınız şubeyi buradan seçin; takvim ve kasa seçili şubeye göre gösterilir.',
    target: '.topbar .branch-btn',
  })
  steps.push({
    id: 'account',
    title: 'Hesabınız',
    text: 'Görünüm (Ferah / Gece), şifre değiştirme ve çıkış burada. Bu tanıtımı da buradan yeniden başlatabilirsiniz.',
    target: mobile ? '.topbar-user .user-btn' : '.sidebar .user-btn',
  })
  steps.push({
    id: 'done',
    title: 'Hazırsınız!',
    text: role === 'owner'
      ? 'İyi bir başlangıç: Ayarlar\'dan online randevu bağlantınızı alıp müşterilerinizle paylaşın; randevular doğrudan takviminize düşsün.'
      : role === 'platform'
        ? 'İlk salonu "Yeni işletme" ile açıp sahibine davet bağlantısını gönderebilirsiniz.'
        : 'İyi çalışmalar! Takıldığınız bir yer olursa bu tanıtımı kullanıcı menüsünden yeniden açabilirsiniz.',
  })
  return steps
}

const DONE_PREFIX = 'rh:tour:'
/** Bu anahtar varsa tur kendiliğinden açılmaz (otomatik testler, kiosk ekranları); menüden yine açılır. */
const OFF_KEY = 'rh:tour-off'

export function tourSeen(userId: string): boolean {
  try { return localStorage.getItem(OFF_KEY) === '1' || localStorage.getItem(DONE_PREFIX + userId) === 'done' } catch { return true }
}
export function markSeen(userId: string) {
  try { localStorage.setItem(DONE_PREFIX + userId, 'done') } catch { /* tarayıcı depolaması kapalıysa tur yalnız bu oturumda kapanır */ }
}
