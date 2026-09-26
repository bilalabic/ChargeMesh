# 09 · Deploy ve Ortam Değişkenleri

Bu belge frontend, API, OCPP simülatörü ve sözleşme araçlarının kullandığı bütün ortam değişkenlerini tek yerde toplar. Gerçek `.env` dosyaları, özel anahtarlar ve MongoDB parolaları repoya eklenmez.

## Çalışma modu politikası

Kullanıcıya açılan normal akış yalnızca canlı moddur:

- Frontend `VITE_API_MODE=live` ile Fastify API'ye bağlanır.
- Backend `CHAIN_MODE=monad` ile Monad testnet'i kullanır.
- Node, slot, intent, rezervasyon ve oturum kayıtları MongoDB Atlas'ta tutulur.
- Sürücü `reserve`, `cancel`, `expire` ve `withdraw` işlemlerini MetaMask'ta onaylar.
- Backend settler hesabı `startSession` ve `settle` işlemlerini gönderir.

`mock` ve Anvil seçenekleri yalnız otomatik test veya geliştirici teşhisi içindir; normal yerel çalışma ve production deploy'da kullanılmaz. `DEMO_ALLOW_ANY_TIME=false` olmalıdır; zaman pencereleri gerçek saat kurallarına göre doğrulanır.

## Yerel canlı başlangıç

`backend/api/.env` dosyasını `.env.example` üzerinden oluşturun ve gerçek `MONGODB_URI` ile testnet `SETTLER_PRIVATE_KEY` değerlerini yalnızca bu dosyada doldurun. Ardından depo kökünde:

```powershell
.\scripts\dev.ps1
```

Betik gizli değerleri okumaz veya yazdırmaz. Atlas indeks kontrolünü çalıştırır ve aşağıdaki public ayarları süreç seviyesinde zorlar: `CHAIN_MODE=monad`, `DEMO_ALLOW_ANY_TIME=false`, `VITE_API_MODE=live`, `VITE_CHAIN_ID=10143`. API Atlas'a bağlanıp Monad modunda hazır olmadan simülatör ve frontend aşamasına geçmez.

Başlangıçtan sonra yapılan `scripts/preflight.ps1` kontrolü hiçbir işlem göndermez. API/chain yapılandırmasını, Atlas'a salt okunur erişimi, OCPP bağlantısını, deployment adreslerini, settler bakiyesini ve saat farkını denetler. İstenirse `-DriverAddress 0x...` ile Sürücü bakiyesi de kontrol edilir.

## Önce değiştirilecek değerler

Production kurulumu için kullanıcı tarafından gerçek değerle değiştirilmesi gerekenler şunlardır:

1. `<BACKEND_DOMAIN>`: Uzun süre çalışan Fastify + OCPP servisinin HTTPS alan adı.
2. `<VERCEL_DOMAIN>`: Vercel frontend production alan adı.
3. `<MONGODB_ATLAS_URI>`: Atlas kullanıcısı ve parolasını içeren bağlantı adresi.
4. `<TESTNET_SETTLER_PRIVATE_KEY>`: Yalnızca Monad testnet için ayrılmış settler hesabının özel anahtarı.
5. `<PUBLIC_MONAD_RPC>`: İstenirse varsayılan Monad RPC yerine kullanılacak güvenilir RPC adresi.
6. `<PUBLIC_OCPP_WSS_URL>`: Simülatörün erişeceği, TLS kullanan OCPP WebSocket adresi.

Zincir kimliği `10143` ve escrow adresi env ile elle verilmez. Escrow adresi `@chargemesh/shared` içindeki `getDeployment(10143)` kaydından gelir.

## Vercel frontend

Vercel projesi depo kökünden build edilmelidir; aksi halde frontend, workspace içindeki `@chargemesh/shared` paketini bulamaz.

| Ayar | Değer |
| --- | --- |
| Root Directory | Depo kökü (`.`) |
| Install Command | `corepack pnpm install --frozen-lockfile` |
| Build Command | `corepack pnpm --filter @chargemesh/frontend build` |
| Output Directory | `frontend/dist` |
| Node.js | 22 veya 24 |

Vercel **Production** ve gerekiyorsa **Preview** ortamına yalnızca şu değişkenler girilir:

```dotenv
VITE_API_MODE=live
VITE_API_URL=https://<BACKEND_DOMAIN>/api/v1
VITE_CHAIN_ID=10143
```

`VITE_` önekli değerler tarayıcı paketine gömülür ve gizli değildir. Buraya özel anahtar, Atlas URI'si, parola veya token yazılmaz. Vercel'de env değişikliği eski deployment'ı değiştirmez; yeni deployment gerekir.

Vue Router `createWebHistory()` kullandığı için Vercel deploy aşamasında bütün uygulama yollarını `/index.html` dosyasına yönlendiren SPA rewrite kuralı da eklenmelidir. Bu ayar deploy turunda `vercel.json` ile eklenecektir.

## Backend API ve OCPP Central System

Backend Vercel frontend projesine konmaz. Fastify API ile uzun süre açık kalan OCPP WebSocket sunucusunu çalıştırabilecek ayrı bir serviste barındırılır.

```dotenv
NODE_ENV=production
PORT=4000
OCPP_PORT=9000

MONGODB_URI=<MONGODB_ATLAS_URI>
MONGODB_DB_NAME=chargemesh
MONGODB_TEST_URI=

WEB_BASE_URL=https://<VERCEL_DOMAIN>

CHAIN_MODE=monad
RPC_URL=<PUBLIC_MONAD_RPC>
SETTLER_PRIVATE_KEY=<TESTNET_SETTLER_PRIVATE_KEY>

QUOTE_TTL_SECONDS=300
RECONCILIATION_INTERVAL_MS=30000
DEMO_ALLOW_ANY_TIME=false
```

| Değişken | Production durumu | Açıklama |
| --- | --- | --- |
| `NODE_ENV` | Zorunlu | `production` kullanılır. |
| `PORT` | Platforma bağlı | HTTP API portu. Hosting platformu otomatik veriyorsa onun verdiği değer korunur. |
| `OCPP_PORT` | Zorunlu | OCPP WebSocket portu. Dışarıdan erişilebilir ve TLS reverse proxy arkasında olmalıdır. |
| `MONGODB_URI` | Zorunlu, gizli | Atlas URI'si. Backend dışında hiçbir yere girilmez. |
| `MONGODB_DB_NAME` | Zorunlu | Önerilen değer `chargemesh`. |
| `MONGODB_TEST_URI` | Production'da boş | Yalnız opt-in Atlas smoke testi içindir. |
| `WEB_BASE_URL` | Zorunlu | CORS ve QR başlangıç URL'si için Vercel production adresi; sonunda `/` olmamalıdır. |
| `CHAIN_MODE` | Zorunlu | Production demo için `monad`. |
| `RPC_URL` | Önerilir | Monad testnet RPC adresi. Boş bırakılırsa shared varsayılanı kullanılır. |
| `SETTLER_PRIVATE_KEY` | Zorunlu, gizli | EIP-712 tekliflerini imzalar, `startSession` ve `settle` gönderir. Yalnız testnet hesabı kullanılır. |
| `QUOTE_TTL_SECONDS` | İsteğe bağlı | Varsayılan `300`; 30–3600 saniye aralığı kabul edilir. |
| `RECONCILIATION_INTERVAL_MS` | İsteğe bağlı | Varsayılan `30000`; 5000–300000 ms aralığı kabul edilir. |
| `DEMO_ALLOW_ANY_TIME` | Zorunlu | Yerel canlı çalışma ve production için `false`; gerçek slot zaman kuralları uygulanır. |

Hosting platformu tek bir public port destekliyorsa mevcut iki-portlu API/OCPP düzeni deploy edilmeden önce çözülmelidir. OCPP bağlantısı sıradan kısa süreli HTTP fonksiyonu değil, kalıcı WebSocket bağlantısı ister.

## OCPP şarj simülatörü

Simülatör ayrı bir uzun süre çalışan süreçtir. Production frontend'in veya Vercel'in içinde çalışmaz.

```dotenv
CS_URL=<PUBLIC_OCPP_WSS_URL>
CHARGE_POINT_ID=CM-DEMO-001
CONNECTOR_ID=1
POWER_KW=7.4
TIME_SCALE=120
METER_INTERVAL_MS=2000
METER_START_WH=1000000
VEHICLE_ACCEPT_WH=
```

| Değişken | Açıklama |
| --- | --- |
| `CS_URL` | OCPP Central System adresi. Production'da `wss://.../ocpp` biçiminde olmalıdır; charge point id uygulama tarafından sona eklenir. |
| `CHARGE_POINT_ID` | Backend'deki node ile aynı kimlik; demo varsayılanı `CM-DEMO-001`. |
| `CONNECTOR_ID` | Demo konektörü; varsayılan `1`. |
| `POWER_KW` | Sabit simülasyon gücü; varsayılan `7.4`. |
| `TIME_SCALE` | Simülasyon hız çarpanı; varsayılan `120`. |
| `METER_INTERVAL_MS` | Sayaç örnekleme aralığı; varsayılan `2000`. |
| `METER_START_WH` | Başlangıç sayaç değeri; varsayılan `1000000`. |
| `VEHICLE_ACCEPT_WH` | İsteğe bağlı kısmi teslim sınırı; boşsa sınırsız. |

## Sözleşme araçları

Bu değerler Vercel'e veya frontend'e girilmez. Yalnızca Foundry deploy/smoke işlemleri içindir:

```dotenv
RPC_URL=https://testnet-rpc.monad.xyz
DEPLOYER_PRIVATE_KEY=<TESTNET_DEPLOYER_PRIVATE_KEY>
SETTLER_ADDRESS=<BACKEND_SETTLER_PUBLIC_ADDRESS>
```

| Değişken | Açıklama |
| --- | --- |
| `RPC_URL` | Yerel Anvil veya Monad testnet RPC'si. |
| `DEPLOYER_PRIVATE_KEY` | Yalnız testnet deployer anahtarı; gizlidir. |
| `SETTLER_ADDRESS` | Backend settler hesabının **public** adresi. Boşsa deployer adresi kullanılır. |

## Yalnız test ve yardımcı betikler

| Değişken | Kullanım |
| --- | --- |
| `MONGODB_TEST_URI` | `test:atlas` opt-in smoke testi. |
| `RUN_ANVIL_INTEGRATION=1` | API Anvil entegrasyon testini açıkça etkinleştirir. |
| `DELIVERED_WH` | `shared/scripts/anvil-e2e.ts` için teslim edilen enerji; varsayılan `14500`. |

## Deploy öncesi kontrol

1. Atlas IP Access List, backend hosting servisinin çıkış erişimine izin vermelidir.
2. `WEB_BASE_URL` ile Vercel production adresi birebir eşleşmelidir.
3. `VITE_API_URL`, dışarıdan erişilen HTTPS backend adresini ve `/api/v1` ekini içermelidir.
4. MetaMask'ta Monad testnet seçilmeli; uygulama gerekirse ağı otomatik eklemeyi teklif eder.
5. Settler adresi deployment kaydıyla ve zincirdeki `settler()` değeriyle aynı olmalıdır.
6. Settler ve Sürücü hesaplarında en az 10 MON rezervi ile işlem gazını karşılayacak ek bakiye bulunmalıdır.
7. API, OCPP simülatörü ve frontend açıldıktan sonra `scripts/preflight.ps1` çalıştırılmalıdır.

Vercel'in güncel Vite ve env davranışları için resmi [Vite rehberi](https://vercel.com/docs/frameworks/frontend/vite) ve [Environment Variables belgesi](https://vercel.com/docs/environment-variables) esas alınır.
