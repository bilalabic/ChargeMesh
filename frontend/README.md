# @chargemesh/frontend

ChargeMesh'in Host ve Driver arayüzü. Host bu ekranlardan şarj noktasını tanımlar ve boş saatlerini yayınlar. Driver ise talebini girer, uygun noktayı rezerve eder, QR ile şarjı başlatır ve oturum bitince Proof of Charge özetini görür.

## Teknoloji

Next.js 16 (App Router), React 19, Tailwind CSS 4, wagmi 3 ve viem 2 (cüzdan ve sözleşme çağrıları), TanStack Query 5.

## Çalıştırma

```powershell
Copy-Item .env.example .env.local
corepack pnpm --filter @chargemesh/frontend dev
```

Uygulama `http://localhost:3000` adresinde açılır.

## İki çalışma modu

| `NEXT_PUBLIC_API_MODE` | Ne olur |
| --- | --- |
| `mock` | API'ye hiç istek atılmaz. Veriler `@chargemesh/shared/fixtures` içindeki demo senaryosundan gelir; eşleştirme de API'nin kullandığı fonksiyonla yapılır. Arayüz geliştirmesi için idealdir. |
| `live` | `NEXT_PUBLIC_API_URL` adresindeki gerçek API kullanılır. Her istek, bağlı cüzdanın adresini `x-wallet-address` başlığıyla gönderir. |

İki mod da aynı `ApiClient` arayüzünü uygular. Bu yüzden bileşenler hangi modda çalıştıklarını bilmez.

## Ortam değişkenleri

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api/v1` | API adresi |
| `NEXT_PUBLIC_API_MODE` | `mock` | `mock` veya `live` |
| `NEXT_PUBLIC_CHAIN_ID` | `10143` | `10143` Monad testnet, `31337` yerel Anvil |

Sözleşme adresi ortam değişkeninden okunmaz; `@chargemesh/shared` içindeki `getDeployment(chainId)` fonksiyonundan gelir.

## Klasör düzeni

```
src/
├── app/            Sayfalar (App Router)
├── lib/
│   ├── api/        ApiClient arayüzü, live ve mock uygulamaları
│   ├── env.ts      Ortam değişkenlerinin doğrulanması
│   └── wagmi.ts    Zincir ve cüzdan yapılandırması
```

## Ekranlar

| Yol | Kim için | Ne var |
| --- | --- | --- |
| `/` | Herkes | Ürünün kısa anlatımı, rol seçimi, cüzdan bağlama |
| `/host` | Host | Şarj noktaları, çevrimiçi durumu, slotlar |
| `/host/nodes/new` | Host | Yeni şarj noktası formu |
| `/host/nodes/[nodeId]` | Host | Slot yayınlama, gelen rezervasyonlar, cihaz QR'ı |
| `/driver` | Driver | Konum, saat ve enerji talebi formu |
| `/driver/intents/[intentId]` | Driver | Sıralanmış uygun noktalar ve rezervasyon |
| `/driver/reservations/[id]` | Driver | Rezervasyon durumu, erişim bilgisi, canlı şarj sayacı |
| `/start?cp=…&c=…` | Driver | Cihazdaki QR okutulunca açılan başlatma sayfası |
| `/reservations/[id]/proof` | İkisi | Proof of Charge özeti ve hash doğrulaması |

## Rezervasyon akışı (kod tarafında)

1. `createReservation({ intentId, slotId })` çağrılır. Yanıtta teklif (`quote`), settler imzası ve sözleşme adresi bulunur.
2. `writeContract({ abi: chargeMeshEscrowAbi, functionName: "reserve", args: [quoteToContractArgs(quote), signature], value: BigInt(quote.depositWei) })`
3. Tx onaylanınca `confirmReservation(id, { txHash })` çağrılır. Bu adımdan sonra açık adres ve erişim talimatı görünür hale gelir.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `corepack pnpm --filter @chargemesh/frontend dev` | Geliştirme sunucusu |
| `corepack pnpm --filter @chargemesh/frontend build` | Üretim derlemesi |
| `corepack pnpm --filter @chargemesh/frontend typecheck` | Tip kontrolü |
| `corepack pnpm --filter @chargemesh/frontend lint` | ESLint |
| `corepack pnpm --filter @chargemesh/frontend test` | Vitest |

Bu klasörde çalışacak ajanlar ve geliştiriciler için kurallar [AGENTS.md](AGENTS.md) dosyasındadır.
