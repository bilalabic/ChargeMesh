# ChargeMesh Frontend

Vue 3 + Vite tabanlı Host ve Sürücü arayüzüdür. `mock` modunda API veya cüzdan gerektirmeden demo akışını tarayıcı içinde çalıştırır; `live` modunda Fastify API ve Monad/Anvil sözleşmesine bağlanır.

## Çalıştırma

```powershell
Copy-Item frontend/.env.example frontend/.env.local
corepack pnpm --filter @chargemesh/frontend dev
```

Uygulama `http://localhost:3000` adresinde açılır. Varsayılan `VITE_API_MODE=mock` değeridir.

MetaMask yalnızca `live` modda açılır. `frontend/.env.local` içinde
`VITE_API_MODE=live` ve hedefe uygun `VITE_API_URL` ayarlandıktan sonra üst
menüdeki **MetaMask'a bağlan** düğmesi hesabı bağlar. Cüzdan farklı bir ağdaysa
uygulama Monad testnet'i eklemeyi veya bu ağa geçmeyi ister. Özel anahtar ve seed
phrase frontend env değişkenlerine hiçbir zaman yazılmaz.

Production ve Vercel dahil bütün ortam değişkenleri için
[deploy ve env rehberine](../docs/09-deploy-ve-env.md) bakın.

## Kontroller

```powershell
corepack pnpm --filter @chargemesh/frontend typecheck
corepack pnpm --filter @chargemesh/frontend lint
corepack pnpm --filter @chargemesh/frontend test
corepack pnpm --filter @chargemesh/frontend build
```

Ekranlar, API sözleşmesi ve cüzdan kuralları için [frontend/AGENTS.md](AGENTS.md) ve [docs/03-api.md](../docs/03-api.md) belgeleri esas alınır.
