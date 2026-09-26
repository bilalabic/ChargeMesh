# ChargeMesh

**ChargeMesh turns underused chargers into reservable charging capacity near where drivers are already going.**

Ofis otoparklarında, otellerde ve sitelerde gün boyu boşta bekleyen AC şarj cihazları var. Öte yandan elektrikli araç sürücüleri, gidecekleri yerde şarj olup olamayacaklarını önceden bilemiyor. ChargeMesh bu iki tarafı buluşturuyor: Cihaz sahibi boş saatlerini yayınlıyor, sürücü de nereye gideceğini, orada ne kadar kalacağını ve ne kadar enerjiye ihtiyaç duyduğunu söylüyor. Gerisini sistem hallediyor.

Rezervasyon ve ödeme Monad testnet üzerinde tutuluyor. Şarj oturumu OCPP protokolüyle ölçülüyor ve ödeme, talep edilen enerjiye göre değil, **gerçekten aktarılan enerjiye göre** kapanıyor.

> Bu bir hackathon projesidir. Gerçek şarj hizmeti sunmaz, gerçek para tahsil etmez. Cihaz tarafı bir OCPP simülatörüyle canlandırılır.

## Nasıl çalışır?

```mermaid
flowchart LR
  H["Host<br/>noktasını ve boş<br/>saatlerini yayınlar"] --> M{{"Deterministik<br/>eşleştirme"}}
  D["Driver<br/>konum, saat ve<br/>kWh ihtiyacını girer"] --> M
  M --> R["Rezervasyon<br/>Monad'da depozito<br/>kilitlenir"]
  R --> Q["QR ile<br/>şarj başlar"]
  Q --> O["OCPP ile<br/>enerji ölçülür"]
  O --> S["Proof of Charge<br/>hash zincire yazılır,<br/>ödeme kullanıma göre kapanır"]
```

1. **Host**, şarj noktasını tanımlar ve uygun olduğu saat aralığını kapasitesiyle birlikte bir *Energy Slot* olarak yayınlar.
2. **Sürücü**, gideceği yeri, varış ve ayrılış saatini ve ihtiyaç duyduğu enerjiyi girer.
3. Sistem uygun slotları bağlantı tipine, erişim koşuluna, mesafeye ve o sürede karşılanabilecek enerjiye göre sıralar.
4. Sürücü seçimini onaylar. Backend'in imzaladığı teklif cüzdandan sözleşmeye gönderilir ve depozito kilitlenir.
5. Sürücü noktaya vardığında QR ile şarjı başlatır. Demoda bu adım tek dizüstü bilgisayarda canlandırılır: QR kodu Host ekranında görünür, Sürücü "Şarjı başlat" düğmesine basar.
6. Oturum bitince özet çıkarılır, özetin hash'i zincire yazılır. Aktarılan enerjinin bedeli Host'a gönderilir, artan depozito Sürücü'ye iade edilir. Alıcılardan biri ödemeyi reddederse tutar kaybolmaz: Alıcının çekilebilir bakiyesine (`pendingWithdrawal`) eklenir ve `withdraw()` ile çekilir.

Örneğin 20 kWh talep eden bir sürücü 0,2 MON depozito yatırır. Araç 14,5 kWh aldıktan sonra ayrılırsa Host'a 0,145 MON ödenir, sürücüye 0,055 MON geri döner.

## Depo yapısı

```
ChargeMesh/
├── frontend/             Frontend ekibi: Host ve Sürücü arayüzü (Vue 3, Vite, @wagmi/vue)
├── backend/              Backend ekibi
│   ├── api/              REST API, eşleştirme, OCPP merkezi, zincir istemcisi (Fastify, MongoDB Atlas)
│   └── charger-sim/      OCPP 1.6J şarj cihazı simülatörü
├── contracts/            Blockchain ekibi: ChargeMeshEscrow akıllı sözleşmesi (Solidity, Foundry)
├── shared/               Ekipler arası sözleşme: API şemaları, ABI, EIP-712, hash ve ücret hesabı
├── scripts/              Yardımcı PowerShell betikleri (dev.ps1, preflight.ps1)
└── docs/                 Ürün ve teknik spesifikasyon
```

Üç ekibin her biri yalnızca kendi klasöründe çalışır: `frontend/`, `backend/` ve `contracts/`. Ortak tanımlar `shared/` klasöründedir ve her klasörün kendi README'si vardır. Spesifikasyonlar `docs/` altında numaralı olarak durur:

| Belge | İçerik |
| --- | --- |
| [01-urun.md](docs/01-urun.md) | Ürün tanımı, roller, sözlük, kapsam |
| [02-mimari.md](docs/02-mimari.md) | Bileşenler, portlar, ortam değişkenleri, durum makineleri |
| [03-api.md](docs/03-api.md) | REST API sözleşmesi, eşleştirme algoritması, Proof of Charge |
| [04-akilli-sozlesme.md](docs/04-akilli-sozlesme.md) | `ChargeMeshEscrow` spesifikasyonu, EIP-712, Monad notları, testler, deploy |
| [05-ocpp.md](docs/05-ocpp.md) | OCPP mesajları ve simülatör davranışı |
| [06-demo-senaryosu.md](docs/06-demo-senaryosu.md) | Kabul testi olarak kullanılan uçtan uca demo ve sunum rehberi |
| [07-paralel-calisma.md](docs/07-paralel-calisma.md) | Sahiplik, dal düzeni, sözleşme değişikliği protokolü, entegrasyon |
| [08-acik-isler.md](docs/08-acik-isler.md) | Ekiplere göre açık işler |
| [09-deploy-ve-env.md](docs/09-deploy-ve-env.md) | Vercel, backend, simülatör ve sözleşme ortam değişkenleri |
| [degisiklik-gunlugu.md](docs/degisiklik-gunlugu.md) | Sözleşme ve entegrasyon değişiklik kaydı |

## Hızlı başlangıç

### Gereksinimler

- Node.js 22 veya 24 LTS (corepack Node ile birlikte gelir)
- MongoDB Atlas kümesi, veritabanı kullanıcısı ve bu bilgisayara izin veren bir IP access list kaydı. Veritabanı yalnızca bulutta çalışır; Docker gerekmez, ama internet bağlantısı gerekir.
- WSL 2 + Ubuntu 24.04 içinde [Foundry](https://getfoundry.sh) (yalnızca sözleşme geliştirme ve yerel Anvil için)
- Tarayıcıda MetaMask ya da benzeri bir cüzdan. Monad testnet'te her cüzdan 10 MON'luk bir tampon bakiye tutmak zorundadır; ayrıntılar [docs/06-demo-senaryosu.md](docs/06-demo-senaryosu.md#bakiyeler-ve-anahtarlar) belgesinde.

### Kurulum

Windows'ta bazı bağımlılık yolları 260 karakter sınırını aşar. Klonlamadan önce uzun yol desteğini açın:

```powershell
git config --global core.longpaths true
git clone --recurse-submodules https://github.com/bilalabic/ChargeMesh.git
cd ChargeMesh
corepack pnpm install
```

Genel git ayarını değiştirmek istemiyorsanız ayarı yalnızca bu klon için verebilirsiniz: `git -c core.longpaths=true clone --recurse-submodules https://github.com/bilalabic/ChargeMesh.git`.

> pnpm'i `corepack` üzerinden çalıştırıyoruz. Böylece herkes `package.json` içinde sabitlenmiş sürümü (pnpm 10) kullanır ve ayrıca bir kurulum yapmak gerekmez.

### Canlı çalışma: Atlas + Monad + MetaMask

Normal çalışma yolu mock kullanmaz. Kalıcı uygulama verisi MongoDB Atlas'a yazılır; rezervasyon MetaMask üzerinden Monad testnet'e gönderilir; `startSession` ve `settle` işlemlerini backend settler hesabı gönderir.

Örnek dosyaları bir kez kopyalayın:

```powershell
Copy-Item backend/api/.env.example backend/api/.env
Copy-Item frontend/.env.example frontend/.env.local
```

`backend/api/.env` içinde en az `MONGODB_URI` ve `SETTLER_PRIVATE_KEY` değerlerini kendiniz doldurun. Bu iki gizli değer yalnızca backend'de kalır; terminal çıktısına, frontend'e veya Vercel'e yazılmaz. Yerel canlı başlatma betiği aşağıdaki güvenli ayarları süreç seviyesinde zorlar:

```dotenv
CHAIN_MODE=monad
DEMO_ALLOW_ANY_TIME=false
VITE_API_MODE=live
VITE_API_URL=http://localhost:4000/api/v1
VITE_CHAIN_ID=10143
```

Ardından tüm sistemi depo kökünden başlatın:

```powershell
.\scripts\dev.ps1
```

Betik önce Atlas indekslerini doğrular, sonra API'yi açar ve API `chainMode: monad` bildirene kadar bekler. Ardından OCPP simülatörünü ve canlı API'ye bağlı frontend'i başlatıp salt okunur ön kontrolü çalıştırır. Betik `.env` dosyasının yalnızca varlığını kontrol eder; gizli değerleri okuyup ekrana basmaz.

MetaMask'ta Monad testnet'i seçin ve frontend'deki **MetaMask'a bağlan** düğmesini kullanın. Host node ve slot kayıtları arayüzden oluşturulur; Sürücü rezervasyonu MetaMask'ta onaylar. Cüzdan parolası, private key veya seed phrase uygulamaya girilmez.

Ön kontrolü tekrar çalıştırmak ve Sürücü bakiyesini de doğrulamak için public cüzdan adresini verebilirsiniz:

```powershell
.\scripts\preflight.ps1 -DriverAddress 0x<SÜRÜCÜ_PUBLIC_ADRESİ>
```

Tüm env alanlarının açıklaması ve production değerleri [docs/09-deploy-ve-env.md](docs/09-deploy-ve-env.md) belgesindedir. Uçtan uca canlı prova [docs/06-demo-senaryosu.md](docs/06-demo-senaryosu.md) üzerinden yürütülür.

### Sık kullanılan komutlar

| Komut | Ne yapar |
| --- | --- |
| `corepack pnpm typecheck` | Tüm paketlerde tip kontrolü |
| `corepack pnpm lint` | Tüm paketlerde lint |
| `corepack pnpm test` | Tüm TypeScript testleri |
| `corepack pnpm --filter @chargemesh/shared chain:sync` | Foundry çıktısından ABI ve deploy adreslerini üretir |

## Teknoloji

| Katman | Seçim |
| --- | --- |
| Arayüz | Vue 3, Vite, Tailwind CSS 4, `@wagmi/vue`, viem 2, `@tanstack/vue-query`; görseller için three.js ve GSAP |
| Backend | Node.js, Fastify 5, MongoDB Atlas, resmi MongoDB Node.js driver |
| Şarj cihazı | OCPP 1.6J (`ocpp-rpc`) |
| Zincir | Monad testnet (chainId 10143), Solidity 0.8.28, Foundry, OpenZeppelin 5 |
| Ortak | TypeScript, zod 4, pnpm workspaces |

## Ekip ve yapay zekâ ajanlarıyla çalışma

Frontend, backend ve blockchain tarafları aynı anda, birbirini beklemeden geliştirilecek şekilde kurgulandı. Ekipler birbirinin koduna değil, `shared` içindeki sözleşmelere ve `docs/` altındaki spesifikasyonlara bağlıdır. Her taraf, karşı tarafı taklit eden bir modla işe başlayabilir: Frontend sahte veriyle, API zincirsiz modda, sözleşmeler de Foundry testleriyle çalışır.

Proje hem Claude Code hem de Codex ile çalışmaya hazırdır:

- Kökteki ve her alt klasördeki `AGENTS.md`, o alanın kurallarını tanımlar. Codex bu dosyaları doğrudan okur.
- `CLAUDE.md` dosyaları `@AGENTS.md` ile aynı içeriği Claude Code'a aktarır. Böylece iki araç tek bir kaynaktan beslenir.
- `.claude/agents/` altında her alan için hazır Claude Code alt ajanları vardır: `frontend-dev`, `backend-dev`, `contracts-dev` ve `integrator`.

Paralel çalışmanın ayrıntıları, dal düzeni ve entegrasyon kontrol listesi [docs/07-paralel-calisma.md](docs/07-paralel-calisma.md) belgesinde.

## Katkı kuralları

- Commit mesajları İngilizce ve [Conventional Commits](https://www.conventionalcommits.org/) biçimindedir: `feat(frontend): add driver intent form`.
- Her değişiklik kendi dalında yapılır ve PR ile `main` dalına birleştirilir. CI yeşil olmadan birleştirme yapılmaz.
- `.env` dosyaları, özel anahtarlar ve seed phrase'ler hiçbir koşulda depoya girmez. Yalnızca testnet ve yerel ağ kullanılır.

## Sınırlar

Simülatörden gelen ölçüm, gerçek donanımdan bağımsız olarak doğrulanmış bir enerji teslimi anlamına gelmez. Demo, ölçüme dayalı kayıt ve hesaplaşma akışının nasıl işlediğini gösterir. Ticari kullanıma geçmeden önce cihaz erişimi, ölçüm güvenliği, ödeme altyapısı ve şarj hizmetine ilişkin yasal yükümlülüklerin ayrıca ele alınması gerekir.
