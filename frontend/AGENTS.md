# frontend: Frontend Ajan Talimatları

Kök `AGENTS.md` kuralları geçerlidir. Bu klasörün sahibi **Frontend** ekibidir. Bu klasör dışında yalnızca `shared/src/fixtures/**` dosyalarını değiştirebilirsin.

## Teknoloji

Next.js 16 (App Router, `src/` dizini), React 19, TypeScript, Tailwind CSS 4, wagmi 3 + viem 2, TanStack Query 5, `qrcode.react`. Yeni bağımlılık eklemeden önce gerçekten gerekli mi diye düşün; UI kit (shadcn gibi) eklenecekse önce kullanıcıya sor.

## Mimari kurallar

- **Veri tipleri** yalnızca `@chargemesh/shared` paketinden gelir. API yanıtları `src/lib/api/` içindeki tek bir istemciden geçer ve ilgili zod şemasıyla `parse` edilir.
- **İki mod** (`NEXT_PUBLIC_API_MODE`):
  - `mock`: `src/lib/api/mock.ts`, `createDemoFixtures()` ve `rankMatches()` ile çalışır. Bileşenler hangi modda olduklarını bilmez; ikisi de aynı arayüzü (`ApiClient`) uygular.
  - `live`: `fetch` ile `NEXT_PUBLIC_API_URL`. Her isteğe `x-wallet-address` başlığı eklenir (`WALLET_HEADER`).
- **Zincir:** Ağ tanımları için `monadTestnet` ve `anvilLocal`, sözleşme için `chargeMeshEscrowAbi` ve `getDeployment(chainId)` kullanılır; hepsi shared'dan alınır. `reserve()` çağrısı `quoteToContractArgs(quote)` ile yapılır ve `value = BigInt(quote.depositWei)` gönderilir. Tx onaylanınca `POST /reservations/:id/confirm` çağrılır.
- **Cüzdan:** wagmi `injected` connector (MetaMask, Rabby). WalletConnect ve RainbowKit kapsam dışıdır.
- **Canlı oturum:** `EventSource(${API_URL}/sessions/:id/events?wallet=0x…)`. Mock modda sayaç zamanlayıcıyla simüle edilir.
- **Proof of Charge ekranı:** `computeSessionHash(summary)` tarayıcıda yeniden hesaplanır ve zincirdeki hash ile karşılaştırılır.
- Para ve enerji gösterimi için `formatMon` ve `whToKwh` kullanılır. Para hesabı `number` ile yapılmaz.
- Sözleşme hataları (`InvalidSignature`, `QuoteExpired`, `SlotAlreadyTaken` vb.) ABI ile çözümlenir ve kullanıcıya Türkçe mesajla gösterilir.

## Ekranlar

| Yol | Rol | İçerik |
| --- | --- | --- |
| `/` | – | Ürünün tek cümlelik anlatımı, "Host olarak devam et" ve "Sürücü olarak devam et" seçenekleri, cüzdan bağlama |
| `/host` | Host | Node listesi, her node için çevrimiçi durumu ve slotlar; "Demo verisi oluştur" (`POST /demo/seed`) |
| `/host/nodes/new` | Host | Node formu (`CreateNodeRequest`) |
| `/host/nodes/[nodeId]` | Host | Slot yayınlama formu, slot listesi, gelen rezervasyonlar, yazdırılabilir QR (`startUrl`) |
| `/driver` | Driver | Intent formu: konum (demo için hazır konum seçenekleri + enlem/boylam), varış, ayrılış, kWh, bağlantı tipi |
| `/driver/intents/[intentId]` | Driver | Sıralı eşleşmeler; kart başına bölge, mesafe, pencere, karşılanabilir kWh, depozito; "Rezerve et" |
| `/driver/reservations/[id]` | Driver | Durum zaman çizelgesi, explorer bağlantıları, erişim bilgisi (onaydan sonra), "Şarjı başlat", canlı sayaç, "Durdur", hesaplaşma sonucu |
| `/start?cp=…&c=…` | Driver | QR iniş sayfası: bu noktadaki rezervasyonu bulur ve oturumu başlatır |
| `/reservations/[id]/proof` | İkisi | Proof of Charge: özet, kanonik JSON, hash doğrulaması, zincir tutarları |

Arayüz metinleri Türkçedir. Mobil genişlikte (QR okutma telefonda yapılır) düzgün görünmelidir.

## Komutlar

```powershell
corepack pnpm --filter @chargemesh/frontend dev        # http://localhost:3000
corepack pnpm --filter @chargemesh/frontend typecheck
corepack pnpm --filter @chargemesh/frontend lint
corepack pnpm --filter @chargemesh/frontend test
corepack pnpm --filter @chargemesh/frontend build
```

## Bitti tanımı (M1)

Mock modda `docs/06-demo-senaryosu.md` içindeki 7 adım, API ve zincir olmadan tarayıcıda baştan sona oynatılabilir. `typecheck`, `lint` ve `build` yeşildir.
