# ChargeMesh Frontend

Vue 3 + Vite tabanlı Host ve Sürücü arayüzüdür. Tüm verileri Fastify API üzerinden MongoDB Atlas'tan alır; zincir işlemlerini MetaMask ile Monad testnet'e gönderir.

## Çalıştırma

```powershell
Copy-Item frontend/.env.example frontend/.env.local
corepack pnpm --filter @chargemesh/frontend dev
```

Uygulama `http://localhost:3000` adresinde açılır. Fastify API'nin de `VITE_API_URL` adresinde çalışıyor olması gerekir.

Üst menüdeki **MetaMask'a bağlan** düğmesi hesabı bağlar. Ağ ve sözleşme bilgileri
backend'in `GET /config` yanıtından alınır; cüzdan farklı bir ağdaysa uygulama bu
ağı eklemeyi veya ağa geçmeyi ister. `VITE_CHAIN_ID` yalnızca beklenen başlangıç
ağını belirtir ve backend yanıtıyla uyuşmazsa arayüz uyarı gösterir. Özel anahtar
ve seed phrase frontend env değişkenlerine hiçbir zaman yazılmaz.

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
