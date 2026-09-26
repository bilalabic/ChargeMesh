# @chargemesh/api

ChargeMesh'in uygulama sunucusu. Şarj noktalarını, slotları ve talepleri saklar; eşleştirmeyi yapar; teklifleri imzalar; zincirdeki rezervasyonu doğrular; şarj cihazlarıyla OCPP üzerinden konuşur ve oturum bitince hesaplaşmayı zincire yazar.

## Teknoloji

Fastify 5, Drizzle ORM ve PostgreSQL 17, viem 2 (zincir), `ocpp-rpc` (OCPP 1.6J), zod 4 (doğrulama), Vitest.

## Çalıştırma

```powershell
corepack pnpm db:up                                   # kökten: PostgreSQL :5433
Copy-Item .env.example .env
corepack pnpm --filter @chargemesh/api db:migrate
corepack pnpm --filter @chargemesh/api dev
```

| Servis | Adres |
| --- | --- |
| REST API | `http://localhost:4000/api/v1` |
| Sağlık kontrolü | `http://localhost:4000/health` |
| OCPP Central System | `ws://localhost:9000/ocpp/{chargePointId}` |

Simülatörü ayrı bir terminalde başlatmak için: `corepack pnpm dev:sim`

## Zincir modları

| `CHAIN_MODE` | Ne olur | Ne zaman |
| --- | --- | --- |
| `mock` | Zincire hiç gidilmez. İmzalar gerçektir ama tx hash'leri sahtedir; `confirm` biçimi doğru her hash'i kabul eder. | Geliştirme ve testler |
| `anvil` | WSL'deki yerel Anvil zinciri kullanılır (`http://localhost:8545`, chainId 31337). | Sözleşmeyle entegrasyon |
| `monad` | Monad testnet kullanılır (chainId 10143). | Demo |

Tüm zincir erişimi `src/chain/index.ts` içindeki `ChainGateway` arayüzünden geçer. Böylece mod değiştirmek iş mantığına dokunmayı gerektirmez.

## Settler anahtarı

API, `SETTLER_PRIVATE_KEY` ile iki iş yapar: rezervasyon tekliflerini EIP-712 ile imzalar, oturum başlangıcını (`startSession`) ve sonucunu (`settle`) zincire gönderir. Bu anahtar **yalnızca testnet** içindir, `.env` dışında hiçbir yere yazılmaz ve gas için az miktarda testnet MON içermelidir. Adresi sözleşmedeki `settler` değeriyle aynı olmalıdır.

## Klasör düzeni

```
src/
├── index.ts        Giriş noktası: HTTP ve OCPP sunucuları
├── app.ts          buildApp(): test edilebilir Fastify örneği
├── config.ts       Ortam değişkenleri (zod ile doğrulanır)
├── http/           Hata biçimi, kimlik başlığı, route'lar
├── domain/         İş kuralları
├── db/             Drizzle şeması ve bağlantı
├── chain/          ChainGateway: mock ve viem uygulamaları
├── ocpp/           OCPP Central System
└── sessions/       Canlı oturum olayları (SSE için)
drizzle/            Üretilen migration'lar
```

## Veritabanı

Şema `src/db/schema.ts` içindedir. Şema değişince:

```powershell
corepack pnpm --filter @chargemesh/api db:generate   # yeni migration üretir
corepack pnpm --filter @chargemesh/api db:migrate    # uygular
```

Üretilen migration dosyaları commit edilir.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `corepack pnpm --filter @chargemesh/api dev` | İzleme modunda çalıştırır |
| `corepack pnpm --filter @chargemesh/api typecheck` | Tip kontrolü |
| `corepack pnpm --filter @chargemesh/api lint` | ESLint |
| `corepack pnpm --filter @chargemesh/api test` | Vitest (veritabanı ve ağ gerektirmez) |

API sözleşmesinin tamamı [docs/03-api.md](../../docs/03-api.md), OCPP ayrıntıları [docs/05-ocpp.md](../../docs/05-ocpp.md) belgesindedir. Bu klasörün kuralları için [AGENTS.md](AGENTS.md) dosyasına bakın.
