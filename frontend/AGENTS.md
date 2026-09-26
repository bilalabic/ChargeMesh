# frontend: Frontend Ajan Talimatları

Kök `AGENTS.md` kuralları geçerlidir. Bu klasörün sahibi **Frontend** ekibidir. Bu klasör dışında yalnızca `shared/src/fixtures/**` dosyalarını değiştirebilirsin.

## Teknoloji

Vue 3 (Composition API, `<script setup lang="ts">`), Vite, Vue Router, Tailwind CSS 4 (`@tailwindcss/vite` eklentisi), `@wagmi/vue` 0.5 + viem 2, `@tanstack/vue-query` 5. Görsel efektler için three.js ve GSAP kullanılabilir; iş mantığı bunlara bağlanmaz. QR görseli için framework'ten bağımsız bir kütüphane (ör. `qrcode`) yeterlidir.

Entegrasyon için değişmeyecek noktalar:

- Paket adı `@chargemesh/frontend` olarak kalır. Yalnızca pnpm workspace kullanılır; `package-lock.json` oluşturulmaz.
- Tüm tipler, şemalar, ABI, adresler ve yardımcılar `@chargemesh/shared` (`workspace:*`) paketinden gelir.
- TypeScript `^5.9` (en az `5.9.3`): `vue-tsc` 3, TypeScript'in JS derleyici API'sine ihtiyaç duyar ve 7.x bu API'yi sunmaz. `@wagmi/vue` da `>=5.9.3` ister.
- Yeni bağımlılık eklemeden önce gerçekten gerekli mi diye düşün; UI kiti eklenecekse önce kullanıcıya sor.

## Ortam değişkenleri

`import.meta.env` üzerinden okunur ve `src/env.d.ts` içinde tiplenir. Değerler `frontend/.env.example` dosyasında tutulur.

| Değişken | Örnek | Açıklama |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:4000/api/v1` | Yalnızca `live` modda kullanılır |
| `VITE_API_MODE` | `mock` | `mock` veya `live` |
| `VITE_CHAIN_ID` | `10143` | wagmi'nin varsayılan ağı (`31337` veya `10143`) |

## Mimari kurallar

- **Veri tipleri** yalnızca `@chargemesh/shared` paketinden gelir. API yanıtları `src/lib/api/` içindeki tek bir istemciden geçer ve ilgili zod şemasıyla `parse` edilir.
- **İki mod** (`VITE_API_MODE`):
  - `mock`: `src/lib/api/mock.ts`, `createDemoFixtures()` ve `rankMatches()` ile çalışır; zincir kimliği `31337`'dir. Bileşenler hangi modda olduklarını bilmez; iki istemci de aynı `ApiClient` arayüzünü uygular.
  - `live`: `fetch` ile `VITE_API_URL`. Her isteğe `x-wallet-address` başlığı eklenir (`WALLET_HEADER`).
- **Zincir bilgisi:** `live` modda `chainId`, `contractAddress` ve `explorerUrl` **yalnızca** `GET /config` yanıtından alınır. `VITE_CHAIN_ID` yalnızca wagmi'nin varsayılan ağıdır; `/config` ile uyuşmazsa uyarı gösterilir ve cüzdandan ağ değiştirmesi istenir. `mock` modda adres `getDeployment(chainId)` ile okunur. `/config` yanıtı `chainMode: "mock"` ise cüzdan açılmaz, sahte bir tx hash'iyle doğrudan `confirm` çağrılır (bkz. `docs/02-mimari.md`).
- **Cüzdan:** `@wagmi/vue` `WagmiPlugin` + `createConfig({ chains: [monadTestnet, anvilLocal], connectors: [injected()] })`; ağ tanımları shared'dan gelir. `VueQueryPlugin` ayrıca kurulur. WalletConnect ve RainbowKit kapsam dışıdır.

### Rezervasyon akışı (`reserve`)

1. `POST /reservations` yanıtındaki `quote`, `signature`, `contractAddress` ve `chainId` kullanılır; argümanlar `quoteToContractArgs(quote)` ile hazırlanır, `value = BigInt(quote.depositWei)`.
2. İşlem önce simüle edilir (`simulateContract`). Simülasyon revert ederse işlem gönderilmez; hata `decodeEscrowError(err)` ile Türkçe mesaja çevrilip gösterilir.
3. Gaz sınırı açıkça verilir: `gas = tahmin × 110n / 100n` (viem `estimateContractGas`). Monad gaz sınırının tamamını ücretlendirir; sınırı gereksiz yüksek tutmak para kaybettirir, tahmini aynen kullanmak ise işlemi gaz yetersizliğiyle düşürebilir.
4. **Rezerv uyarısı:** `bakiye − depozito − (gas × maxFeePerGas) < 10 MON` ise Sürücü uyarılır; bu durumda işlem revert edebilir. Hesaba yeni para geldiyse birkaç blok beklemesi önerilir.
5. İşlem `useWriteContract` (`@wagmi/vue`) ile gönderilir. Hash gelince `POST /reservations/:id/confirm` çağrılır. Backend kesinleşmeyi beklediği için yanıt birkaç saniye sürebilir; zaman aşımında aynı hash'le tekrar denenir (idempotent).

Cüzdandaki kullanıcı reddi `decodeEscrowError` tarafından tanınmaz (`null` döner); bu durumda "İşlem iptal edildi" gibi genel bir mesaj gösterilir.

### Diğer zincir işlemleri

- **Bekleyen ödeme:** Bağlı cüzdanın `pendingWithdrawal(adres)` değeri doğrudan sözleşmeden okunur (API'de bu alan yoktur). Sıfırdan büyükse üst kısımda "Bekleyen ödemeniz var" bandı ve `withdraw()` düğmesi gösterilir.
- **Depozitoyu geri al (`expire`):** Düğme `CONFIRMED` rezervasyonlarda `window.endsAt` geçince, `ACTIVE`, `COMPLETED` ve `FAILED` rezervasyonlarda `window.endsAt + 1 gün` geçince görünür. İşlem onaylanınca `POST /reservations/:id/sync` çağrılır.
- **İptal (`cancel`):** Başlangıçtan önce Sürücü'ye sunulur, ardından `sync` çağrılır.
- Bu işlemler de aynı kurala uyar: önce simülasyon, açık gaz sınırı, `decodeEscrowError` ile Türkçe hata.
- **Explorer bağlantıları:** `explorerTxUrl(chainId, hash)` ve `explorerAddressUrl` ile üretilir; `null` dönerse (anvil, mock) bağlantı gösterilmez.

### Canlı oturum ve Proof

- **SSE:** ``new EventSource(`${API_URL}/sessions/${id}/events?wallet=0x…`)``. Olaylar: `session.updated`, `meter`, `settled`, `session.error`. `settled` gelince bağlantı kapatılır. Mock modda sayaç zamanlayıcıyla simüle edilir.
- **Proof of Charge ekranı:** `computeSessionHash(summary)` tarayıcıda yeniden hesaplanır ve zincirdeki hash ile karşılaştırılır. `onchain` `null` ise (henüz `SETTLED` değil) "Hesaplaşma bekleniyor" gösterilir.
- Para ve enerji gösterimi için `formatMon` ve `whToKwh` kullanılır. Para hesabı `number` ile yapılmaz. Eşleşme kartındaki "karşılanabilir kWh" değeri `quotedWh`'tir.

## Ekranlar

| Yol | Rol | İçerik |
| --- | --- | --- |
| `/` | – | Ürünün tek cümlelik anlatımı, "Host olarak devam et" ve "Sürücü olarak devam et" seçenekleri, cüzdan bağlama |
| `/host` | Host | Node listesi, her node için çevrimiçi durumu ve slotlar; "Demo verisi oluştur" (`POST /demo/seed`) |
| `/host/nodes/new` | Host | Node formu (`CreateNodeRequest`) |
| `/host/nodes/:nodeId` | Host | Slot yayınlama formu, slot listesi, gelen rezervasyonlar, QR görseli (`startUrl`) |
| `/driver` | Sürücü | Intent formu: konum (demo için hazır konum seçenekleri + enlem/boylam), varış, ayrılış, kWh, bağlantı tipi |
| `/driver/intents/:intentId` | Sürücü | Sıralı eşleşmeler; kart başına bölge, mesafe, pencere, karşılanabilir kWh (`quotedWh`), depozito; "Rezerve et" |
| `/driver/reservations/:id` | Sürücü | Durum zaman çizelgesi, explorer bağlantıları, erişim bilgisi (onaydan sonra), "Şarjı başlat", canlı sayaç, "Durdur", hesaplaşma sonucu, gerektiğinde "Depozitoyu geri al" |
| `/start?cp=…&c=…` | Sürücü | QR'daki başlatma bağlantısı: bu noktadaki rezervasyonu bulur ve oturumu başlatır |
| `/reservations/:id/proof` | İkisi | Proof of Charge: özet, kanonik JSON, hash doğrulaması, zincir tutarları |

Arayüz metinleri Türkçedir. Demo tek dizüstü bilgisayarda yapılır: QR, Host ekranında yalnızca görsel olarak durur; Sürücü aynı tarayıcıda "Şarjı başlat" düğmesine basar veya `/start` bağlantısını açar. Telefon desteği gerekmez, ancak dar ekranda düzen bozulmamalıdır.

## Komutlar

```powershell
corepack pnpm --filter @chargemesh/frontend dev        # http://localhost:3000 (Vite)
corepack pnpm --filter @chargemesh/frontend typecheck  # vue-tsc --noEmit
corepack pnpm --filter @chargemesh/frontend lint
corepack pnpm --filter @chargemesh/frontend test       # vitest
corepack pnpm --filter @chargemesh/frontend build
```

`dev` betiği 3000 portunu kullanır (`vite --port 3000 --strictPort`).

## Bitti tanımı (M1)

Mock modda `docs/06-demo-senaryosu.md` içindeki 7 adım, API ve zincir olmadan tarayıcıda baştan sona oynatılabilir. `typecheck`, `lint`, `test` ve `build` yeşildir.
