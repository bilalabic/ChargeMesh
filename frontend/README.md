# ChargeMesh Frontend

Vue 3 + Vite tabanlı Host ve Sürücü arayüzüdür. `mock` modunda API veya cüzdan gerektirmeden demo akışını tarayıcı içinde çalıştırır; `live` modunda Fastify API ve Monad/Anvil sözleşmesine bağlanır.

## Çalıştırma

```powershell
Copy-Item frontend/.env.example frontend/.env.local
corepack pnpm --filter @chargemesh/frontend dev
```

Uygulama `http://localhost:3000` adresinde açılır. Varsayılan `VITE_API_MODE=mock` değeridir.

## Kontroller

```powershell
corepack pnpm --filter @chargemesh/frontend typecheck
corepack pnpm --filter @chargemesh/frontend lint
corepack pnpm --filter @chargemesh/frontend test
corepack pnpm --filter @chargemesh/frontend build
```

Ekranlar, API sözleşmesi ve cüzdan kuralları için [frontend/AGENTS.md](AGENTS.md) ve [docs/03-api.md](../docs/03-api.md) belgeleri esas alınır.
