import { DB_VERSION, type DB } from '../application/db'
import { withVat } from '../domain/money'
import { lineTotal, ticketTotals } from '../domain/ticket'
import { addDays, weekday } from '../domain/time'
import type {
  Appointment, AppointmentStatus, Branch, CategoryKey, Customer, MessageTemplate, PackageDef, Payment, Product,
  Service, ServiceCategory, Staff, Tenant, Ticket, TicketLine, WeekHours,
} from '../domain/types'
import { emptyDb } from './localStore'

/** Deterministik PRNG (mulberry32) */
function prng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    chance: (p: number) => next() < p,
  }
}

const hours = (open: number, close: number, sunday: [number, number] | null = null): WeekHours => ({
  0: sunday ? { open: sunday[0], close: sunday[1] } : null,
  1: { open, close }, 2: { open, close }, 3: { open, close }, 4: { open, close }, 5: { open, close }, 6: { open, close: close },
})
const withOff = (h: WeekHours, off: number): WeekHours => ({ ...h, [off]: null })

const TL = (n: number) => n * 100
const HISTORY = 45

const FEMALE = ['Elif', 'Zeynep', 'Merve', 'Ayşe', 'Esra', 'Büşra', 'Selin', 'Deniz', 'Ece', 'Gizem', 'Sena', 'İrem', 'Damla', 'Melis', 'Gül', 'Nazlı', 'Ceren', 'Derya', 'Pınar', 'Hande', 'Tuğba', 'Aslı', 'Burcu', 'Dilara', 'Yasemin', 'Özge', 'Ebru', 'Cansu', 'Sibel', 'Nur', 'Beren', 'Ilgın', 'Defne', 'Asya', 'Eylül']
const MALE = ['Mehmet', 'Mustafa', 'Ahmet', 'Ali', 'Hüseyin', 'Emre', 'Can', 'Burak', 'Murat', 'Oğuz', 'Kerem', 'Yiğit', 'Berk', 'Arda', 'Kaan', 'Onur', 'Serkan', 'Tolga', 'Umut', 'Barış', 'Furkan', 'Hakan', 'Volkan', 'Efe', 'Alp', 'Doruk', 'Ege', 'Cem', 'Sinan', 'Deniz']
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Yıldırım', 'Öztürk', 'Aydın', 'Özdemir', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kara', 'Koç', 'Kurt', 'Özkan', 'Şimşek', 'Polat', 'Erdoğan', 'Aksoy', 'Tekin', 'Ünal', 'Güneş', 'Korkmaz', 'Bulut', 'Acar', 'Karaca', 'Akın', 'Sarı', 'Uçar', 'Türkmen', 'Ateş']

const NOTES_F = ['Boya: 7.1 + %6 oksidan, 35 dk', 'Saç derisi hassas, amonyaksız boya', 'Kısa kesim sever, ense düz', 'Balyaj: 9.1 tonlama', 'Fön sonrası ısı koruyucu', 'Kahve ikramı: sade', 'Kakülü uzatıyor', 'Keratin 3 ayda bir', '']
const NOTES_M = ['Yanlar 1 numara, üst makas', 'Sakal 3 mm, çene hattı keskin', 'Fade, üst 5 cm', 'Ustura hassasiyeti var', 'Sadece Mert Usta', '']

interface ServiceSpec { cat: string; name: string; dur: number; price: number; online?: boolean }

interface SalonSpec {
  id: string
  name: string
  slug: string
  color: string
  plan: Tenant['plan']
  branches: { id: string; name: string; address: string; phone: string; hours: WeekHours }[]
  categories: { key: string; name: string; color: CategoryKey }[]
  services: ServiceSpec[]
  staff: { id: string; branch: string; name: string; title: string; color: string; cats: string[]; off: number; svc: number; prd: number }[]
  products: Omit<Product, 'id' | 'tenantId' | 'vatRate'>[] // fiyatlar KDV dahil (raf), seed'de hariçe çevrilir
  packages: { name: string; items: [string, number, number?][]; price: number; validDays: number }[]
  accounts: { name: string; kind: 'pos' | 'bank' }[]
  businessType: Tenant['businessType']
  license: { startOffset: number; days: number }
  customers: number
  femaleRatio: number
  dailyFill: number // 0-1 doluluk
}

const SALONS: SalonSpec[] = [
  {
    id: 't_lara', name: 'Studio Lara', slug: 'studio-lara', color: '#6c5ce7', plan: 'pro',
    branches: [
      { id: 'b_lara', name: 'Lara', address: 'Güzeloba Mah. 2236 Sk. No:14, Muratpaşa / Antalya', phone: '2423240000', hours: hours(540, 1200) },
      { id: 'b_konyaalti', name: 'Konyaaltı', address: 'Liman Mah. Atatürk Blv. No:88, Konyaaltı / Antalya', phone: '2422290000', hours: hours(600, 1170, [660, 1080]) },
    ],
    categories: [
      { key: 'kesim', name: 'Kesim', color: 'kesim' },
      { key: 'boya', name: 'Boya & Renk', color: 'boya' },
      { key: 'bakim', name: 'Bakım', color: 'bakim' },
      { key: 'fon', name: 'Fön & Şekillendirme', color: 'fon' },
      { key: 'tirnak', name: 'Tırnak', color: 'tirnak' },
    ],
    services: [
      { cat: 'kesim', name: 'Kadın Saç Kesimi', dur: 45, price: 600 },
      { cat: 'kesim', name: 'Erkek Saç Kesimi', dur: 30, price: 400 },
      { cat: 'kesim', name: 'Çocuk Kesimi', dur: 30, price: 300 },
      { cat: 'kesim', name: 'Kakül Kesimi', dur: 15, price: 150 },
      { cat: 'boya', name: 'Dip Boya', dur: 90, price: 1400 },
      { cat: 'boya', name: 'Tüm Boya', dur: 120, price: 2200 },
      { cat: 'boya', name: 'Ombre', dur: 180, price: 4500, online: false },
      { cat: 'boya', name: 'Balyaj', dur: 210, price: 5500, online: false },
      { cat: 'boya', name: 'Röfle', dur: 150, price: 3200 },
      { cat: 'boya', name: 'Tonlama', dur: 60, price: 900 },
      { cat: 'bakim', name: 'Keratin Bakımı', dur: 150, price: 3500 },
      { cat: 'bakim', name: 'Brezilya Fönü', dur: 180, price: 4000 },
      { cat: 'bakim', name: 'Saç Botoksu', dur: 120, price: 2800 },
      { cat: 'bakim', name: 'Olaplex Bakım', dur: 60, price: 1200 },
      { cat: 'bakim', name: 'Maske Bakım', dur: 30, price: 450 },
      { cat: 'fon', name: 'Fön', dur: 30, price: 350 },
      { cat: 'fon', name: 'Maşa / Dalga', dur: 45, price: 600 },
      { cat: 'fon', name: 'Topuz', dur: 60, price: 1200 },
      { cat: 'fon', name: 'Gelin Saçı', dur: 120, price: 4500, online: false },
      { cat: 'tirnak', name: 'Manikür', dur: 45, price: 450 },
      { cat: 'tirnak', name: 'Pedikür', dur: 60, price: 600 },
      { cat: 'tirnak', name: 'Kalıcı Oje', dur: 60, price: 700 },
      { cat: 'tirnak', name: 'Protez Tırnak', dur: 120, price: 1800 },
    ],
    staff: [
      { id: 's_ayse', branch: 'b_lara', name: 'Ayşe Yılmaz', title: 'Kuaför Ustası', color: '#e17055', cats: ['kesim', 'boya', 'bakim', 'fon'], off: 1, svc: 40, prd: 10 },
      { id: 's_mert', branch: 'b_lara', name: 'Mert Kaya', title: 'Renk Uzmanı', color: '#0984e3', cats: ['boya', 'bakim', 'fon'], off: 2, svc: 40, prd: 10 },
      { id: 's_selin', branch: 'b_lara', name: 'Selin Demir', title: 'Kuaför', color: '#00b894', cats: ['kesim', 'fon', 'bakim'], off: 3, svc: 35, prd: 10 },
      { id: 's_burak', branch: 'b_lara', name: 'Burak Tan', title: 'Erkek Kuaförü', color: '#8e6cf0', cats: ['kesim'], off: 1, svc: 35, prd: 10 },
      { id: 's_ece', branch: 'b_lara', name: 'Ece Polat', title: 'Manikür & Pedikür', color: '#e84393', cats: ['tirnak'], off: 4, svc: 30, prd: 10 },
      { id: 's_deniz', branch: 'b_konyaalti', name: 'Deniz Aksoy', title: 'Kuaför Ustası', color: '#fdcb6e', cats: ['kesim', 'boya', 'bakim', 'fon'], off: 2, svc: 40, prd: 10 },
      { id: 's_irem', branch: 'b_konyaalti', name: 'İrem Çelik', title: 'Kuaför', color: '#00cec9', cats: ['kesim', 'fon', 'tirnak'], off: 3, svc: 35, prd: 10 },
    ],
    products: [
      { name: 'Onarıcı Şampuan 300 ml', brand: 'Kérastase', category: 'Şampuan', kind: 'retail', price: TL(1450), cost: TL(900), stock: 14, critical: 4 },
      { name: 'Renk Koruyucu Şampuan', brand: "L'Oréal Pro", category: 'Şampuan', kind: 'retail', price: TL(780), cost: TL(450), stock: 9, critical: 4 },
      { name: 'Keratin Maske 250 ml', brand: 'Olaplex', category: 'Bakım', kind: 'retail', price: TL(1650), cost: TL(1050), stock: 3, critical: 4 },
      { name: 'No.3 Hair Perfector', brand: 'Olaplex', category: 'Bakım', kind: 'retail', price: TL(1390), cost: TL(850), stock: 11, critical: 3 },
      { name: 'Isı Koruyucu Sprey', brand: 'Moroccanoil', category: 'Şekillendirici', kind: 'retail', price: TL(990), cost: TL(600), stock: 7, critical: 3 },
      { name: 'Argan Yağı 100 ml', brand: 'Moroccanoil', category: 'Bakım', kind: 'retail', price: TL(1750), cost: TL(1100), stock: 6, critical: 3 },
      { name: 'Mor Şampuan', brand: 'Fanola', category: 'Şampuan', kind: 'retail', price: TL(520), cost: TL(290), stock: 2, critical: 3 },
      { name: 'Saç Boyası 7.1', brand: 'Majirel', category: 'Boya', kind: 'professional', price: 0, cost: TL(260), stock: 18, critical: 6 },
      { name: 'Saç Boyası 9.1', brand: 'Majirel', category: 'Boya', kind: 'professional', price: 0, cost: TL(260), stock: 12, critical: 6 },
      { name: 'Oksidan %6 1 L', brand: 'Majirel', category: 'Boya', kind: 'professional', price: 0, cost: TL(320), stock: 8, critical: 3 },
      { name: 'Açıcı Toz 500 g', brand: 'Blondor', category: 'Boya', kind: 'professional', price: 0, cost: TL(950), stock: 4, critical: 2 },
      { name: 'Kalıcı Oje (Nude)', brand: 'OPI', category: 'Tırnak', kind: 'professional', price: 0, cost: TL(380), stock: 10, critical: 3 },
      { name: 'El Kremi', brand: 'OPI', category: 'Tırnak', kind: 'retail', price: TL(450), cost: TL(240), stock: 15, critical: 4 },
    ],
    packages: [
      { name: '8+2 Fön Paketi', items: [['Fön', 8, 2]], price: 2400, validDays: 120 },
      { name: 'Keratin + 3 Maske', items: [['Keratin Bakımı', 1], ['Maske Bakım', 3]], price: 4200, validDays: 120 },
      { name: '4 Seans Manikür & Kalıcı Oje', items: [['Kalıcı Oje', 4]], price: 2400, validDays: 120 },
    ],
    businessType: 'kuafor',
    license: { startOffset: -25, days: 30 },
    accounts: [{ name: 'Garanti POS', kind: 'pos' }, { name: 'Ziraat POS', kind: 'pos' }, { name: 'İş Bankası (Havale)', kind: 'bank' }, { name: 'Garanti (Havale)', kind: 'bank' }],
    customers: 120,
    femaleRatio: 0.8,
    dailyFill: 0.6,
  },
  {
    id: 't_mert', name: 'Berber Mert', slug: 'berber-mert', color: '#12a37b', plan: 'baslangic',
    branches: [
      { id: 'b_muratpasa', name: 'Muratpaşa', address: 'Şirinyalı Mah. 1505 Sk. No:3, Muratpaşa / Antalya', phone: '2423160000', hours: hours(540, 1260, [600, 1140]) },
    ],
    categories: [
      { key: 'kesim', name: 'Kesim', color: 'kesim' },
      { key: 'sakal', name: 'Sakal & Tıraş', color: 'sakal' },
      { key: 'bakim', name: 'Bakım', color: 'bakim' },
      { key: 'boya', name: 'Renk', color: 'boya' },
    ],
    services: [
      { cat: 'kesim', name: 'Saç Kesimi', dur: 30, price: 400 },
      { cat: 'kesim', name: 'Saç + Sakal', dur: 45, price: 550 },
      { cat: 'kesim', name: 'Fade Kesim', dur: 45, price: 500 },
      { cat: 'kesim', name: 'Çocuk Kesimi', dur: 30, price: 250 },
      { cat: 'sakal', name: 'Sakal Tıraşı', dur: 15, price: 200 },
      { cat: 'sakal', name: 'Ustura Tıraş', dur: 30, price: 300 },
      { cat: 'sakal', name: 'Sakal Şekillendirme', dur: 15, price: 250 },
      { cat: 'bakim', name: 'Yüz Bakımı', dur: 30, price: 450 },
      { cat: 'bakim', name: 'Cilt Maskesi', dur: 15, price: 300 },
      { cat: 'bakim', name: 'Kulak / Burun Ağda', dur: 15, price: 100 },
      { cat: 'bakim', name: 'Keratin', dur: 60, price: 1200 },
      { cat: 'boya', name: 'Saç Boyama', dur: 45, price: 700 },
      { cat: 'boya', name: 'Sakal Boyama', dur: 15, price: 300 },
    ],
    staff: [
      { id: 's_mertu', branch: 'b_muratpasa', name: 'Mert Öztürk', title: 'Usta', color: '#12a37b', cats: ['kesim', 'sakal', 'bakim', 'boya'], off: 1, svc: 0, prd: 0 },
      { id: 's_can', branch: 'b_muratpasa', name: 'Can Yıldız', title: 'Berber', color: '#0984e3', cats: ['kesim', 'sakal', 'bakim'], off: 2, svc: 45, prd: 10 },
      { id: 's_emre', branch: 'b_muratpasa', name: 'Emre Şahin', title: 'Berber', color: '#e17055', cats: ['kesim', 'sakal', 'boya'], off: 3, svc: 45, prd: 10 },
      { id: 's_yigit', branch: 'b_muratpasa', name: 'Yiğit Arslan', title: 'Kalfa', color: '#8e6cf0', cats: ['kesim', 'sakal'], off: 4, svc: 35, prd: 10 },
    ],
    products: [
      { name: 'Mat Wax 100 ml', brand: 'Reuzel', category: 'Şekillendirici', kind: 'retail', price: TL(650), cost: TL(380), stock: 12, critical: 4 },
      { name: 'Sakal Yağı 30 ml', brand: 'Proraso', category: 'Sakal', kind: 'retail', price: TL(480), cost: TL(260), stock: 8, critical: 3 },
      { name: 'Sakal Şampuanı', brand: 'Proraso', category: 'Sakal', kind: 'retail', price: TL(420), cost: TL(230), stock: 2, critical: 3 },
      { name: 'Tıraş Kremi', brand: 'Proraso', category: 'Tıraş', kind: 'professional', price: 0, cost: TL(210), stock: 9, critical: 3 },
      { name: 'Kolonya 400 ml', brand: 'Eyüp Sabri Tuncer', category: 'Tıraş', kind: 'professional', price: 0, cost: TL(180), stock: 6, critical: 2 },
      { name: 'Saç Spreyi', brand: 'Morfose', category: 'Şekillendirici', kind: 'retail', price: TL(260), cost: TL(140), stock: 10, critical: 3 },
      { name: 'Ustura Jileti (100 adet)', brand: 'Derby', category: 'Tıraş', kind: 'professional', price: 0, cost: TL(350), stock: 3, critical: 2 },
    ],
    packages: [
      { name: '10\'lu Tıraş Kartı', items: [['Sakal Tıraşı', 10]], price: 1700, validDays: 180 },
      { name: 'Aylık Bakım (4× Saç + Sakal)', items: [['Saç + Sakal', 4]], price: 1900, validDays: 45 },
    ],
    businessType: 'berber',
    license: { startOffset: -40, days: 365 },
    accounts: [{ name: 'Ziraat POS', kind: 'pos' }, { name: 'Ziraat (Havale)', kind: 'bank' }],
    customers: 70,
    femaleRatio: 0,
    dailyFill: 0.55,
  },
]

export const TEMPLATES: Omit<MessageTemplate, 'id' | 'tenantId'>[] = [
  { kind: 'confirm', name: 'Randevu onayı', enabled: true, body: 'Merhaba {musteri}, {tarih} {saat} için {salon} randevunuz oluşturuldu ({hizmet} – {personel}). Görüşmek üzere!' },
  { kind: 'reminder', name: 'Randevu hatırlatma', enabled: true, hoursBefore: 24, body: 'Hatırlatma: {musteri}, yarın {saat}\'te {salon} randevunuz var. Değişiklik için bu mesajı yanıtlayabilirsiniz.' },
  { kind: 'cancel', name: 'İptal bildirimi', enabled: true, body: 'Merhaba {musteri}, {tarih} {saat} randevunuz iptal edilmiştir. Yeni randevu için bize ulaşın.' },
  { kind: 'birthday', name: 'Doğum günü', enabled: true, body: 'İyi ki doğdun {musteri}! 🎉 {salon} olarak bu ay tüm hizmetlerde %15 indirim seni bekliyor.' },
  { kind: 'winback', name: 'Uzun süredir gelmeyen', enabled: false, body: 'Seni özledik {musteri}! {salon}\'da yeni dönem kampanyalarımızı kaçırma.' },
]

export function buildSeed(today: string, nowMin = 690): DB {
  const r = prng(20261120)
  const db = emptyDb()
  db.version = DB_VERSION
  db.seededFor = today
  let seq = 0
  const id = (p: string) => `${p}${(++seq).toString(36)}`
  const code = () => 'RH-' + Math.floor(r.next() * 36 ** 6).toString(36).toUpperCase().padStart(6, '0')
  const iso = (date: string, min: number) => `${date}T${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00+03:00`

  db.users.push({ id: 'u_platform', tenantId: null, name: 'Comodo Yönetici', role: 'platform', branchIds: [] })

  for (const spec of SALONS) {
    const T = spec.id
    const tenant: Tenant = {
      id: T, name: spec.name, slug: spec.slug, logoColor: spec.color, plan: spec.plan, status: 'active',
      onlineBooking: { enabled: true, requireApproval: true, maxDaysAhead: 30, minLeadMinutes: 120 }, createdAt: addDays(today, -200),
      businessType: spec.businessType, license: { start: addDays(today, spec.license.startOffset), days: spec.license.days },
      invite: { token: `used${T}`, createdAt: addDays(today, -200), usedAt: addDays(today, -199) },
      accounts: spec.accounts.map((a, i) => ({ id: `acc_${T}_${i}`, name: a.name, kind: a.kind, active: true })),
      expenseCategories: ['Malzeme', 'Kira', 'Fatura', 'Maaş / Avans', 'Temizlik', 'Mutfak / İkram', 'Kargo', 'Diğer'],
      brands: [...new Set(spec.products.map((p) => p.brand))].sort((a, b) => a.localeCompare(b, 'tr')),
      productCategories: [...new Set(spec.products.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'tr')),
    }
    const posIds = tenant.accounts.filter((a) => a.kind === 'pos').map((a) => a.id)
    const bankIds = tenant.accounts.filter((a) => a.kind === 'bank').map((a) => a.id)
    db.tenants.push(tenant)
    const branches: Branch[] = spec.branches.map((b) => ({ ...b, tenantId: T }))
    db.branches.push(...branches)

    const cats: ServiceCategory[] = spec.categories.map((c, i) => ({ id: `c_${T}_${c.key}`, tenantId: T, name: c.name, color: c.color, order: i }))
    db.categories.push(...cats)
    const catKey = (cid: string) => spec.categories.find((c) => `c_${T}_${c.key}` === cid)!.key
    const services: Service[] = spec.services.map((s) => ({
      id: id('sv_'), tenantId: T, categoryId: `c_${T}_${s.cat}`, name: s.name, duration: s.dur, price: TL(s.price), online: s.online ?? true, overrides: {},
    }))
    db.services.push(...services)

    const staff: Staff[] = spec.staff.map((s) => {
      const br = branches.find((b) => b.id === s.branch)!
      return {
        id: s.id, tenantId: T, branchId: s.branch, name: s.name, title: s.title, color: s.color, phone: `53${r.int(10000000, 99999999)}`,
        hours: withOff(br.hours, s.off), serviceIds: services.filter((sv) => s.cats.includes(catKey(sv.categoryId))).map((sv) => sv.id),
        serviceCommission: s.svc, productCommission: s.prd, active: true,
        commissionMode: (s.id === 's_burak' || s.id === 's_can' ? 'tiered' : 'category') as Staff['commissionMode'],
        categoryRates: s.id === 's_ayse' ? { [`c_${T}_boya`]: 35, [`c_${T}_kesim`]: 45 } : {},
        serviceRates: {},
        brandRates: (T === 't_lara' ? { Olaplex: 15, Moroccanoil: 12 } : { Proraso: 15 }) as Record<string, number>,
        tiers: [{ from: 0, rate: 0 }, { from: TL(20000), rate: 35 }, { from: TL(50000), rate: 45 }],
      }
    })
    db.staff.push(...staff)
    // Kıdemli usta farkı
    const senior = staff[0]
    for (const sv of services.filter((x) => senior.serviceIds.includes(x.id)).slice(0, 4)) sv.overrides[senior.id] = { price: Math.round((sv.price * 1.2) / 5000) * 5000 }

    // Kullanıcılar
    const ownerName = T === 't_lara' ? 'Zeynep Arıkan' : 'Mert Öztürk'
    db.users.push({ id: `u_${T}_owner`, tenantId: T, name: ownerName, role: 'owner', branchIds: branches.map((b) => b.id), staffId: T === 't_mert' ? 's_mertu' : undefined })
    db.users.push({ id: `u_${T}_rec`, tenantId: T, name: T === 't_lara' ? 'Gamze (Resepsiyon)' : 'Okan (Resepsiyon)', role: 'reception', branchIds: branches.map((b) => b.id) })
    const staffUser = staff[T === 't_lara' ? 0 : 1]
    db.users.push({ id: `u_${T}_staff`, tenantId: T, name: staffUser.name, role: 'staff', staffId: staffUser.id, branchIds: [staffUser.branchId] })

    // Müşteriler
    const customers: Customer[] = []
    const usedPhones = new Set<string>()
    for (let i = 0; i < spec.customers; i++) {
      const female = r.chance(spec.femaleRatio)
      const first = female ? r.pick(FEMALE) : r.pick(MALE)
      let phone = ''
      do phone = `5${r.pick(['30', '32', '33', '35', '36', '38', '41', '42', '44', '45', '05', '06', '07', '52', '53', '55'])}${r.int(1000000, 9999999)}`
      while (usedPhones.has(phone))
      usedPhones.add(phone)
      const tags: string[] = []
      if (r.chance(0.1)) tags.push('VIP')
      const c: Customer = {
        id: id('m_'), tenantId: T, name: `${first} ${r.pick(LAST)}`, phone, gender: female ? 'k' : 'e',
        birthday: r.chance(0.7) ? `${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}` : undefined,
        tags, notes: r.pick(female ? NOTES_F : NOTES_M), consentSms: r.chance(0.85), createdAt: addDays(today, -r.int(5, 400)),
      }
      customers.push(c)
    }
    // Birinin doğum günü bugün olsun
    customers[3].birthday = today.slice(5)
    db.customers.push(...customers)

    // Ürünler
    const products: Product[] = spec.products.map((p) => ({ ...p, price: Math.round(p.price / 1.2), cost: Math.round(p.cost / 1.2), vatRate: 20, id: id('p_'), tenantId: T }))
    db.products.push(...products)
    for (const p of products) db.stockMoves.push({ id: id('sm_'), tenantId: T, productId: p.id, date: addDays(today, -45), qty: p.stock + r.int(12, 22), kind: 'in', note: 'Açılış stoku' })
    const retail = products.filter((p) => p.kind === 'retail')

    // Paketler
    const byName = (n: string) => services.find((s) => s.name === n)!
    const packages: PackageDef[] = spec.packages.map((p) => ({
      id: id('pd_'), tenantId: T, name: p.name, items: p.items.map(([n, count, bonus]) => ({ serviceId: byName(n).id, count, ...(bonus ? { bonus } : {}) })), price: TL(p.price), validDays: p.validDays, active: true,
    }))
    db.packageDefs.push(...packages)

    // Şablonlar
    for (const t of TEMPLATES) db.templates.push({ ...t, id: id('tp_'), tenantId: T })

    // Randevular + adisyonlar
    const regulars = customers.slice(0, Math.floor(customers.length * 0.6))
    for (let d = -HISTORY; d <= 14; d++) {
      const date = addDays(today, d)
      const wd = weekday(date)
      const weekendBoost = wd === 5 || wd === 6 ? 0.12 : 0
      for (const s of staff) {
        const h = s.hours[wd]
        if (!h) continue
        const fill = d < 0 ? spec.dailyFill + weekendBoost : d === 0 ? spec.dailyFill + 0.1 : Math.max(0.08, spec.dailyFill - d * 0.06)
        let t = h.open + (r.chance(0.5) ? 0 : 15 * r.int(1, 3))
        const lunch = 780 + 15 * r.int(0, 4)
        while (t < h.close - 15) {
          if (t >= lunch && t < lunch + 45) { t = lunch + 45; continue }
          if (!r.chance(fill)) { t += 15 * r.int(1, 4); continue }
          const svcId = r.pick(s.serviceIds)
          const svc = services.find((x) => x.id === svcId)!
          const items = [svc]
          if (r.chance(0.2)) {
            const extraId = r.pick(s.serviceIds)
            const extra = services.find((x) => x.id === extraId)!
            if (extra.id !== svc.id && extra.duration <= 45) items.push(extra)
          }
          const dur = items.reduce((a, x) => a + (x.overrides[s.id]?.duration ?? x.duration), 0)
          if (t + dur > h.close) break
          const cust = r.chance(0.08) ? null : r.chance(0.75) ? r.pick(regulars) : r.pick(customers)
          let status: AppointmentStatus
          if (d < 0) status = r.chance(0.05) ? 'no_show' : r.chance(0.06) ? 'cancelled' : 'completed'
          else if (d === 0) status = t + dur <= nowMin ? 'completed' : t <= nowMin ? 'in_service' : t - nowMin < 30 ? 'arrived' : r.chance(0.15) ? 'pending' : 'confirmed'
          else status = r.chance(0.06) ? 'pending' : 'confirmed'
          const source = cust === null ? 'walkin' : r.chance(0.22) ? 'online' : r.chance(0.3) ? 'phone' : 'reception'
          const appt: Appointment = {
            id: id('a_'), tenantId: T, branchId: s.branchId, staffId: s.id, customerId: cust?.id ?? null, date, start: t, end: t + dur,
            items: items.map((x) => ({ serviceId: x.id, price: x.overrides[s.id]?.price ?? x.price, duration: x.overrides[s.id]?.duration ?? x.duration })),
            status, source, note: r.chance(0.08) ? r.pick(['İlk kez geliyor', 'Kahve ikramı', 'Kızıyla gelecek', 'Saç fotoğrafı getirecek']) : '',
            code: code(), createdAt: iso(addDays(date, -r.int(0, 10)), 600),
          }
          db.appointments.push(appt)

          if (status === 'completed') {
            const lines: TicketLine[] = appt.items.map((it) => ({
              id: id('l_'), kind: 'service', refId: it.serviceId, name: services.find((x) => x.id === it.serviceId)!.name, staffId: s.id, qty: 1, unitPrice: it.price, discount: null,
            }))
            if (retail.length && r.chance(0.14)) {
              const p = r.pick(retail)
              lines.push({ id: id('l_'), kind: 'product', refId: p.id, name: p.name, staffId: s.id, qty: 1, unitPrice: withVat(p.price, p.vatRate), discount: null })
              db.stockMoves.push({ id: id('sm_'), tenantId: T, productId: p.id, date, qty: -1, kind: 'sale', note: '' })
            }
            const ticket: Ticket = {
              id: id('k_'), tenantId: T, branchId: s.branchId, date, customerId: appt.customerId, appointmentId: appt.id, lines,
              discount: r.chance(0.07) ? { type: 'percent', value: r.pick([10, 15, 20]) } : null,
              tip: r.chance(0.12) ? TL(r.pick([50, 100, 200])) : 0, payments: [], status: 'closed', createdAt: iso(date, t), closedAt: iso(date, t + dur),
            }
            if (ticket.tip) ticket.tipStaffId = s.id
            const total = ticketTotals(ticket).total
            const payments: Payment[] = []
            const roll = r.next()
            if (roll < 0.38) payments.push({ method: 'cash', amount: total })
            else if (roll < 0.9) payments.push({ method: 'card', amount: total, accountId: r.pick(posIds) })
            else if (roll < 0.95) payments.push({ method: 'transfer', amount: total, accountId: r.pick(bankIds) })
            else if (cust && d > -20) {
              const half = Math.round(total / 2 / 100) * 100
              payments.push({ method: 'cash', amount: half }, { method: 'debt', amount: total - half })
            } else payments.push({ method: 'card', amount: total, accountId: r.pick(posIds) })
            ticket.payments = payments
            db.tickets.push(ticket)
          }
          t += dur + (r.chance(0.3) ? 15 : 0)
        }
      }

      // Giderler ve gün sonu
      if (d < 0) {
        for (const b of branches) {
          if (!b.hours[wd]) continue
          if (r.chance(0.18)) {
            const cat = r.pick(['Malzeme', 'Temizlik', 'Mutfak / İkram', 'Fatura', 'Kargo'])
            db.expenses.push({ id: id('e_'), tenantId: T, branchId: b.id, date, category: cat, amount: TL(r.int(3, 30) * 50), method: r.chance(0.6) ? 'cash' : 'card', note: '' })
          }
        }
      }
    }
    // Kira gideri
    for (const b of branches) db.expenses.push({ id: id('e_'), tenantId: T, branchId: b.id, date: addDays(today, -19), category: 'Kira', amount: TL(T === 't_lara' ? 45000 : 28000), method: 'transfer', note: 'Kasım kirası' })

    // Gün sonu kapanışları (geçmiş günler)
    for (let d = -HISTORY; d < 0; d++) {
      const date = addDays(today, d)
      for (const b of branches) {
        if (!b.hours[weekday(date)]) continue
        const cashIn = db.tickets
          .filter((k) => k.tenantId === T && k.branchId === b.id && k.date === date)
          .reduce((s, k) => s + k.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0), 0)
        const cashOut = db.expenses.filter((e) => e.tenantId === T && e.branchId === b.id && e.date === date && e.method === 'cash').reduce((s, e) => s + e.amount, 0)
        const expected = cashIn - cashOut
        const diff = r.chance(0.1) ? TL(r.pick([-50, -20, 10, 20])) : 0
        db.dayCloses.push({
          id: id('dz_'), tenantId: T, branchId: b.id, date, expectedCash: expected, countedCash: expected + diff,
          note: diff ? 'Bozuk para farkı' : '', closedBy: `u_${T}_rec`, locked: true,
        })
      }
    }

    // Veresiye tahsilatı (bazı borçlar ödenmiş)
    const debtTickets = db.tickets.filter((k) => k.tenantId === T && k.payments.some((p) => p.method === 'debt'))
    for (const k of debtTickets.slice(0, Math.floor(debtTickets.length / 2))) {
      const amount = k.payments.find((p) => p.method === 'debt')!.amount
      const date = addDays(k.date, r.int(3, 10))
      if (date >= today) continue
      db.debtCollections.push({ id: id('dc_'), tenantId: T, branchId: k.branchId, customerId: k.customerId!, date, amount, method: 'cash' })
    }

    // Satılmış paketler
    for (let i = 0; i < 6; i++) {
      const pd = packages[i % packages.length]
      const cust = regulars[i * 3]
      const soldOn = addDays(today, -r.int(5, 40))
      const remaining = Object.fromEntries(pd.items.map((it) => { const total = it.count + (it.bonus ?? 0); return [it.serviceId, Math.max(1, total - r.int(0, total - 1))] }))
      const line: TicketLine = { id: id('l_'), kind: 'package_sale', refId: pd.id, name: pd.name, qty: 1, unitPrice: pd.price, discount: null }
      const ticket: Ticket = {
        id: id('k_'), tenantId: T, branchId: branches[0].id, date: soldOn, customerId: cust.id, lines: [line], discount: null, tip: 0,
        payments: [{ method: 'card', amount: lineTotal(line), accountId: posIds[0] }], status: 'closed', createdAt: iso(soldOn, 700), closedAt: iso(soldOn, 705),
      }
      db.tickets.push(ticket)
      db.customerPackages.push({ id: id('cp_'), tenantId: T, customerId: cust.id, packageDefId: pd.id, remaining, soldOn, expiresOn: addDays(soldOn, pd.validDays), ticketId: ticket.id })
    }

    // Stokları satışlarla tutarlı hale getir
    for (const p of products) {
      const desired = spec.products.find((x) => x.name === p.name)!.stock
      const current = db.stockMoves.filter((m) => m.productId === p.id).reduce((s, m) => s + m.qty, 0)
      if (current < desired) db.stockMoves.push({ id: id('sm_'), tenantId: T, productId: p.id, date: addDays(today, -20), qty: desired - current, kind: 'in', note: 'Tedarikçi siparişi' })
      p.stock = Math.max(current, desired)
    }
    // Kritik seviyede ürünler kalsın
    for (const p of products.slice(0, 3)) {
      const target = Math.max(0, p.critical - 1)
      if (p.stock > target) {
        db.stockMoves.push({ id: id('sm_'), tenantId: T, productId: p.id, date: addDays(today, -2), qty: target - p.stock, kind: 'use', note: 'Salon kullanımı' })
        p.stock = target
      }
    }

    // Molalar / izinler
    const firstStaff = staff[1]
    db.blocks.push({ id: id('bl_'), tenantId: T, staffId: firstStaff.id, date: addDays(today, 3), start: 0, end: 1440, kind: 'leave', note: 'Yıllık izin' })
    for (const s of staff.slice(0, 3)) {
      if (!s.hours[weekday(today)]) continue
      const busy = db.appointments.filter((a) => a.staffId === s.id && a.date === today)
      const lunch = [765, 780, 795, 810, 825, 840].find((m) => !busy.some((a) => a.start < m + 30 && m < a.end))
      if (lunch) db.blocks.push({ id: id('bl_'), tenantId: T, staffId: s.id, date: today, start: lunch, end: lunch + 30, kind: 'break', note: 'Öğle arası' })
    }

    // Mesaj kayıtları
    for (const a of db.appointments.filter((x) => x.tenantId === T && x.date === addDays(today, 1) && x.customerId).slice(0, 8)) {
      const c = customers.find((x) => x.id === a.customerId)!
      db.messages.push({
        id: id('ml_'), tenantId: T, customerId: c.id, appointmentId: a.id, kind: 'reminder', channel: 'sms', to: c.phone,
        body: `Hatırlatma: ${c.name.split(' ')[0]}, yarın randevunuz var. — ${spec.name}`, status: 'simulated', at: iso(today, 600),
      })
    }

    // Boya kartları (boya yapan salonlarda)
    if (T === 't_lara') {
      const shades = ['6.0', '7.1', '7.3', '8.1', '9.1', '10.21', '5.35', '6.45']
      for (const c of regulars.slice(0, 18)) {
        for (let k = 0; k < r.int(1, 3); k++) {
          const brand = r.pick(['Majirel', 'Igora', 'Inoa', 'Koleston'])
          db.colorCards.push({
            id: id('cc_'), tenantId: T, customerId: c.id, date: addDays(today, -r.int(3, 120)), staffId: r.pick(['s_ayse', 's_mert']),
            items: Array.from({ length: r.int(1, 3) }, () => ({ brand, shade: r.pick(shades), grams: r.pick([20, 30, 40, 60]) })),
            developer: r.pick(['%6 (20 vol)', '%9 (30 vol)', '%3 (10 vol)']), processingMin: r.pick([25, 30, 35, 40]),
            note: r.pick(['Dipler önce, uçlara son 10 dk', 'Tonlama ile bitirildi', 'Saç derisi hassas, bariyer krem', '', 'Gri kapatma %100']),
            liked: r.chance(0.5),
          })
        }
      }
    }
  }

  // Platform listesinde filtreleri göstermek için hafif işletmeler (randevusuz)
  const light: { id: string; name: string; slug: string; color: string; type: Tenant['businessType']; owner: string; start: number; days: number; plan: Tenant['plan']; invited: boolean; cats: [string, 'bakim' | 'fon' | 'tirnak' | 'boya' | 'kesim'][] }[] = [
    { id: 't_nuans', name: 'Nüans Güzellik', slug: 'nuans-guzellik', color: '#e84393', type: 'guzellik', owner: 'Derya Uçar', start: -31, days: 30, plan: 'pro', invited: false, cats: [['Cilt Bakımı', 'bakim'], ['Lazer Epilasyon', 'fon'], ['Kaş & Kirpik', 'tirnak']] },
    { id: 't_gulus', name: 'Gülüş Diş Kliniği', slug: 'gulus-dis', color: '#0984e3', type: 'dis', owner: 'Dt. Kerem Aksoy', start: -2, days: 30, plan: 'kurumsal', invited: true, cats: [['Muayene', 'kesim'], ['Dolgu & Kanal', 'boya'], ['Temizlik & Beyazlatma', 'bakim']] },
  ]
  for (const l of light) {
    db.tenants.push({
      id: l.id, name: l.name, slug: l.slug, logoColor: l.color, plan: l.plan, status: 'active', createdAt: addDays(today, l.start),
      onlineBooking: { enabled: true, requireApproval: true, maxDaysAhead: 30, minLeadMinutes: 120 },
      businessType: l.type, license: { start: addDays(today, l.start), days: l.days },
      invite: l.invited ? { token: `davet${l.id.slice(2)}demo2026`, createdAt: addDays(today, l.start) } : { token: `used${l.id}`, createdAt: addDays(today, l.start), usedAt: addDays(today, l.start + 1) },
      accounts: [{ id: `acc_${l.id}_pos`, name: 'POS cihazı', kind: 'pos', active: true }, { id: `acc_${l.id}_bank`, name: 'Banka hesabı', kind: 'bank', active: true }],
      expenseCategories: ['Malzeme', 'Kira', 'Fatura', 'Maaş / Avans', 'Temizlik', 'Diğer'], brands: [], productCategories: [],
    })
    db.branches.push({ id: `b_${l.id}`, tenantId: l.id, name: 'Merkez', address: 'Antalya', phone: '2420000000', hours: hours(540, 1140) })
    db.users.push({ id: `u_${l.id}_owner`, tenantId: l.id, name: l.owner, role: 'owner', branchIds: [`b_${l.id}`] })
    l.cats.forEach(([name, color], i) => db.categories.push({ id: `c_${l.id}_${i}`, tenantId: l.id, name, color, order: i }))
    for (const t of TEMPLATES) db.templates.push({ ...t, id: id('tp_'), tenantId: l.id })
  }

  return db
}
