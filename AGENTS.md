# ChargeMesh: Ajan Talimatları (kök)

Bu dosya Claude Code (`CLAUDE.md` → `@AGENTS.md`) ve Codex tarafından otomatik okunur. Alt klasörlerdeki `AGENTS.md` dosyaları bu kuralları kendi alanları için genişletir.

## Proje

ChargeMesh, atıl AC şarj cihazlarının kapasitesini, sürücünün gideceği yerde rezerve edilebilir hale getirir. Rezervasyon ve hesaplaşma Monad testnet'te tutulur, şarj oturumu OCPP simülatörüyle ölçülür. Hackathon projesidir: tek bir uçtan uca demo senaryosu hedeflenir.

İşe başlamadan önce oku: `docs/01-urun.md` (kapsam) ve `docs/07-paralel-calisma.md` (sahiplik ve iş akışı). Alanına göre ek belgeler:

| Alan | Klasör | Oku |
| --- | --- | --- |
| Frontend | `frontend` | `docs/03-<frontend|api|charger-sim|shared>.md`, `docs/04-akilli-sozlesme.md` (EIP-712 ve hatalar) |
| Backend | `backend/<frontend|api|charger-sim|shared>`, `backend/charger-sim` | `docs/02-mimari.md`, `docs/03-api.md`, `docs/05-ocpp.md` |
| Blockchain | `contracts` | `docs/04-akilli-sozlesme.md` |
| Entegrasyon | hepsi | `docs/06-demo-senaryosu.md`, `docs/07-paralel-calisma.md` |

## Değişmez kurallar

1. **Kendi alanında kal.** Yalnızca görevlendirildiğin klasörü değiştir (sahiplik tablosu: `docs/07-paralel-calisma.md`). Başka ekibin koduna ihtiyaç duyarsan kodu değil, sözleşmesini (şema, ABI, belge) kullan.
2. **Sözleşmeler donmuştur.** `shared/src/**`, `contracts/src/interfaces/**` ve `docs/03-05` dosyalarında değişiklik gerekiyorsa dur. Gerekçeyi yaz ve "sözleşme değişikliği protokolü"nü uygula (`docs/07-paralel-calisma.md`). Sessizce değiştirme; kendi tarafında geçici tip veya kopya da oluşturma.
3. **Kendi versiyonunu yazma.** Kimlik dönüşümü (`ids.ts`), ücret hesabı (`units.ts`), Proof of Charge hash'i (`proof.ts`), eşleştirme (`matching.ts`), EIP-712 (`chain/eip712.ts`) ve ABI/adresler (`chain/`) yalnızca `@chargemesh/shared` paketinden alınır.
4. **Birimler:** Enerji tam sayı Wh, para wei (API'de ondalık string, kodda `bigint`), zaman ISO 8601 UTC (zincirde Unix saniyesi). `number` ile para hesabı yapılmaz.
5. **Gizli bilgi yok:** `.env`, özel anahtar ve seed phrase asla okunmaz, yazdırılmaz ve commit edilmez. Yeni değişken eklenirse `.env.example` güncellenir. Yalnızca testnet ve yerel ağ kullanılır.
6. **Kapsam:** `docs/01-urun.md` içindeki "Yapılmayacaklar" listesindeki hiçbir şey eklenmez (token, NFT, AI, dinamik fiyat vb.).

## Ortam

- Windows 11 + PowerShell. Paket yöneticisi **pnpm 10**, `corepack` üzerinden çalışır: `corepack pnpm <komut>`. (`pnpm.exe` v11 bu makinede Device Guard tarafından engelleniyor; global `pnpm` ya da `npm install` kullanma.)
- Node.js 22+. TypeScript `^5.9` (7.x kullanma).
- Foundry yalnızca WSL'de çalışır:
  `wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && ~/.foundry/bin/forge test"`
  (Worktree'de çalışıyorsan yolu kendi klasörüne göre değiştir.)
- Kalıcı veri MongoDB Atlas'ta tutulur. Bağlantı yalnızca `MONGODB_URI` ve `MONGODB_DB_NAME`
  ortam değişkenlerinden okunur; URI ve kimlik bilgileri loglanmaz.

## Komutlar (kökten)

| Amaç | Komut |
| --- | --- |
| Kurulum | `corepack pnpm install` |
| Tip kontrolü | `corepack pnpm typecheck` |
| Lint | `corepack pnpm lint` |
| Test | `corepack pnpm test` |
| Tek paket | `corepack pnpm --filter @chargemesh/<frontend|api|charger-sim|shared>\|api\|charger-sim\|shared> <script>` |
| ABI ve adresleri güncelle | `corepack pnpm --filter @chargemesh/shared chain:sync` (önce `forge build`) |

## İş bitirme tanımı

Bir işi "bitti" saymadan önce:

1. Kendi paketinde `typecheck`, `lint` ve `test` (contracts için `forge build` + `forge test`) çalıştır. Sonucu olduğu gibi raporla; geçmeyen bir adımı geçti diye yazma.
2. `git diff` ile değişikliği gözden geçir. Alan dışı dosya değişmemiş olmalı.
3. Commit mesajı **İngilizce** ve Conventional Commits biçiminde olmalı: `feat(frontend): …`, `fix(backend): …`, `test(contracts): …`, `docs: …`.
4. Push, PR, deploy ve zincire işlem gönderme gibi adımları kullanıcı onayı olmadan yapma.

## Dil

- Kod, tanımlayıcılar, commit mesajları ve kod yorumları İngilizce yazılır.
- `README.md` dosyaları ve `docs/` Türkçedir. Türkçe metinler çeviri kokmamalı; doğal ve akıcı yazılmalıdır. Teknik terimler (endpoint, slot, settlement vb.) gerektiğinde İngilizce bırakılır.
- Kullanıcıya görünen arayüz metinleri Türkçedir.
