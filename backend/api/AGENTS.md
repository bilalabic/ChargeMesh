# backend/api: Backend Ajan Talimatları

Kök `AGENTS.md` kuralları geçerlidir. Bu klasörün ve `backend/charger-sim` klasörünün sahibi **Backend** ekibidir. `shared/src/api/**` şemalarının da sahibi sensin, ama bu dosyalardaki değişiklikler protokole tabidir (`docs/07-paralel-calisma.md`).

## Teknoloji

Node.js 22+, TypeScript (ESM), Fastify 5, zod 4 (girdiler handler içinde shared şemalarla `parse` edilir; ayrı bir type provider kullanılmaz), Drizzle ORM + `postgres` sürücüsü, PostgreSQL 17 (Docker, `:5433`), viem 2, `ocpp-rpc`, Vitest. Geliştirme sırasında `tsx watch` kullanılır.

## Klasör düzeni

```
src/
  index.ts            # entry: HTTP (:4000) + OCPP (:9000)
  config.ts           # env parse (zod), fail fast
  app.ts              # buildApp(): Fastify instance, testable without listen()
  http/
    errors.ts         # ApiError -> { error: { code, message, details } }
    auth.ts           # x-wallet-address -> request.wallet (lower-case)
    routes/           # system, nodes, slots, intents, reservations, sessions, demo
  domain/             # business rules; no Fastify/DB types leak in
  db/
    schema.ts         # Drizzle tables
    client.ts
  chain/
    index.ts          # ChainGateway interface
    mock.ts           # CHAIN_MODE=mock
    viem.ts           # CHAIN_MODE=anvil|monad (signQuote, verifyReserveTx, startSession, settle, readReservation)
  ocpp/
    server.ts         # ocpp-rpc RPCServer, handlers, charger registry
  sessions/
    events.ts         # in-process pub/sub for SSE
drizzle/              # generated migrations (committed)
```

## Kurallar

- Uç noktalar, gövdeler ve yanıtlar `docs/03-api.md` ve `@chargemesh/shared` şemalarıyla **birebir** aynıdır. Her route, girişi shared şemasıyla doğrular ve çıkışı aynı şemaya uyar. Yeni bir alan gerekiyorsa önce protokolü uygula.
- Hata biçimi ve kodları `ApiErrorCode` ile `API_ERROR_HTTP_STATUS` üzerinden belirlenir.
- **Zincir erişimi yalnızca `ChainGateway` arayüzünden** yapılır. `CHAIN_MODE=mock` tüm akışı zincir olmadan çalıştırabilmelidir; testler bu modda koşar.
- Eşleştirme için `rankMatches` (shared) çağrılır; algoritmayı yeniden yazma. Kimlikler `toOnchainReservationId`, `toSlotRef`, `toOcppIdTag`; tutarlar `depositFor` ve `computeSettlement`; hash `computeSessionHash` ile üretilir.
- Teklif imzası: `SETTLER_PRIVATE_KEY` → `signTypedData(buildQuoteTypedData(quote, chainId, escrow))`. Sözleşme adresi `getDeployment(chainId)` fonksiyonundan okunur.
- Slot tutma yarışları için `POST /reservations` işlemi tek bir DB transaction'ında ve slot satırı kilitlenerek (`SELECT … FOR UPDATE`) yapılır.
- Özel alanlar (`addressLine`, `lat`, `lng`, `accessInstructions`) yalnızca `docs/03-api.md` içinde tanımlanan koşullarda döner. Loglara da yazılmaz.
- Veritabanı: Para `numeric(78,0)`, enerji `integer`, zaman `timestamptz`. Migration'lar `drizzle-kit generate` ile üretilir ve commit edilir.
- `settle` başarısız olursa rezervasyon `FAILED` olur ve yeniden denenebilir. Ağ hataları sessizce yutulmaz.

## Komutlar

```powershell
corepack pnpm db:up                                   # kökten, PostgreSQL :5433
corepack pnpm --filter @chargemesh/api db:migrate
corepack pnpm --filter @chargemesh/api dev            # :4000 + OCPP :9000
corepack pnpm --filter @chargemesh/api typecheck
corepack pnpm --filter @chargemesh/api lint
corepack pnpm --filter @chargemesh/api test
```

## Bitti tanımı (M1)

`CHAIN_MODE=mock` ile, simülatör bağlıyken `docs/06-demo-senaryosu.md` akışının tamamı (seed → intent → matches → reservation → confirm → session start → meter → stop → settle → proof) yalnızca HTTP çağrılarıyla çalışır. Bu akış bir entegrasyon testiyle (Vitest) doğrulanır.
