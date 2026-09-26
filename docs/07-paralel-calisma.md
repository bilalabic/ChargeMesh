# 07 · Paralel Çalışma ve Entegrasyon

> Sürüm: v1.1 · Bu belge; Frontend, Backend ve Blockchain ekiplerinin (insan ya da Claude Code/Codex ajanı fark etmeksizin) aynı anda, birbirini beklemeden ve birbirinin işini bozmadan nasıl çalışacağını tanımlar.

## Temel ilke

Ekipler birbirinin **koduna değil, sözleşmelerine** bağımlıdır. Sözleşmeler projenin başında donduruldu:

| Sözleşme | Nerede | Kimi bağlar |
| --- | --- | --- |
| REST API ve veri modelleri | `shared/src/api/` + [03-api.md](03-api.md) | Frontend ↔ API |
| Akıllı sözleşme arayüzü ve ABI | `contracts/src/interfaces/IChargeMeshEscrow.sol` + `shared/src/chain/abi.ts` + [04-akilli-sozlesme.md](04-akilli-sozlesme.md) | Contracts ↔ Frontend, API |
| EIP-712 teklif tanımı | `shared/src/chain/eip712.ts` | Contracts ↔ API ↔ Frontend |
| Proof of Charge ve kanonik JSON | `shared/src/proof.ts` | API ↔ Frontend ↔ Contracts |
| OCPP mesajları | [05-ocpp.md](05-ocpp.md) | API ↔ Simülatör |
| Demo verisi | `shared/src/fixtures/` + [06-demo-senaryosu.md](06-demo-senaryosu.md) | Herkes |

Her ekip, karşı tarafı taklit eden bir modla işe başlar:

- **Frontend** (Vue 3 + Vite), `VITE_API_MODE=mock` ile fixture'lardan beslenir. Cüzdan işlemleri için Monad testnet (isteğe bağlı olarak yerel Anvil) kullanılır.
- **API**, `CHAIN_MODE=mock` ile zincire hiç dokunmadan tüm akışı çalıştırabilir. Veritabanı MongoDB Atlas'tır; `/health`, `/config` ve `/chargers` uç noktaları veritabanı bağlantısı olmadan da çalışır. Simülatör aynı ekibe ait olduğu için OCPP tarafı hazırdır.
- **Contracts**, Foundry testleriyle tamamen bağımsızdır.

## Sahiplik

| Yol | Sahip | Diğer ekipler |
| --- | --- | --- |
| `frontend/**` | Frontend | Dokunmaz |
| `backend/api/**`, `backend/charger-sim/**` | Backend | Dokunmaz |
| `contracts/**` | Blockchain | Dokunmaz |
| `shared/src/chain/abi.ts`, `deployments.ts` | Blockchain (yalnızca `chain:sync` ile üretilir) | Dokunmaz |
| `shared/src/chain/{errors,events,status,types,finality,index}.ts`, `shared/scripts/` | Blockchain | Protokolle değiştirir |
| `shared/src/chain/chains.ts` | Ortak | Protokolle değiştirir |
| `shared/src/api/**` | Backend | Ekleme önerir |
| `shared/src/{ids,units,proof,matching}.ts`, `chain/eip712.ts` | Ortak (sözleşme dosyası) | Protokolle değiştirir |
| `shared/src/fixtures/**` | Frontend | Backend'in testleri de okuyabilir |
| `docs/**`, kök yapılandırma, `scripts/`, `AGENTS.md`, `CLAUDE.md` | Entegrasyon sorumlusu | Öneri PR'ı açar |

## Dal ve worktree düzeni

Her ekip kendi dalında ve ayrı bir klasörde çalışır. Böylece aynı makinede üç ajan aynı anda çalışabilir:

```powershell
# Ana klasör: C:\Users\bilal\projects\ChargeMesh  (main)
git worktree add ..\ChargeMesh-frontend  -b feat/frontend
git worktree add ..\ChargeMesh-backend   -b feat/backend
git worktree add ..\ChargeMesh-contracts -b feat/contracts
```

- Her worktree'de `corepack pnpm install` ayrıca çalıştırılır.
- Ajan (Claude Code veya Codex) ilgili worktree klasöründe başlatılır. Böylece alt klasördeki `AGENTS.md`/`CLAUDE.md` dosyaları otomatik yüklenir.
- API worktree'leri aynı Atlas veritabanına eşzamanlı yazmamalıdır. Paralel API çalıştırılacaksa ayrı `MONGODB_DB_NAME`, `PORT` ve `OCPP_PORT` değerleri kullanılmalıdır.
- `main` dalına doğrudan commit atılmaz. İşler küçük PR'larla `main` dalına birleştirilir.

## Commit ve PR kuralları

- Commit mesajları **İngilizce** ve [Conventional Commits](https://www.conventionalcommits.org/) biçimindedir. Kapsam, alanın adıdır: `frontend`, `backend`, `contracts` veya `shared`. Belge ve kök dosya değişiklikleri kapsamsız yazılır (`docs:`, `chore:`).
  - `feat(frontend): add driver intent form`
  - `feat(backend): implement deterministic slot matching`
  - `test(contracts): cover partial delivery settlement`
  - `feat(shared): add ChargingSession schema` · `docs: clarify quote expiry`
- Bir commit yalnızca bir ekibin alanına dokunur. Tek istisna, sözleşme değişikliği protokolüyle yapılan `shared` değişiklikleridir.
- PR açıklaması şablona uyar (`.github/pull_request_template.md`). CI yeşil olmadan birleştirme yapılmaz.
- `.env` dosyaları, özel anahtarlar ve seed phrase'ler **asla** commit edilmez.

## Sözleşme değişikliği protokolü

Donmuş bir sözleşmenin değiştirilmesi gerekiyorsa şu adımlar izlenir:

1. **Ekleme mi, kırıcı değişiklik mi?** Yeni isteğe bağlı alan veya yeni uç nokta eklemek *ekleme* sayılır. Alan silmek, yeniden adlandırmak, tip veya anlam değiştirmek ise *kırıcı değişikliktir*.
2. Değişiklik ayrı bir dalda ve tek bir PR'da yapılır: `contract/<kısa-ad>`. Bu PR şunları içerir:
   - `shared` içindeki kod değişikliği
   - İlgili `docs/0x-*.md` güncellemesi
   - [degisiklik-gunlugu.md](degisiklik-gunlugu.md) dosyasına bir satır
3. Commit türü `feat(shared)!:` (kırıcı) veya `feat(shared):` (ekleme) olur.
4. Kırıcı değişiklikler, etkilenen ekiplerin onayı alınmadan birleştirilmez. PR'da ilgili ekip etiketlenir.
5. Birleştirme sonrası diğer ekipler kendi dallarına `main`'i alır: `git merge main`.

Ajanlar için kural: **Bir ajan, kendi alanı dışındaki bir sözleşme dosyasını tek başına değiştirmez.** Değişiklik gerekiyorsa işi durdurur, gerekçeyi yazar ve bir `contract/*` PR'ı önerir.

### Protokol ihlali olduğunda

Bir ekip dalında, ekibin kendi kodunun yanında `docs/**` veya kök dosyalarda (`package.json`, `.gitignore`, `AGENTS.md` vb.) değişiklik de bulunabilir. Bu genellikle iyi niyetlidir: Mimari bir karar değişmiştir ve belgelerin de güncellenmesi gerekir. Böyle bir durumda entegrasyon sorumlusu PR'ı reddetmez, ikiye ayırır:

1. Ekibin kendi alanındaki kod değişiklikleri ekip PR'ında kalır.
2. `docs/**` ve kök dosyalardaki değişiklikler ayrı bir PR'a taşınır ve entegrasyon sorumlusunun onayıyla birleştirilir.

Örnek: Veritabanının PostgreSQL'den MongoDB Atlas'a geçişinde backend kodu ile mimari belgeler ve kök yapılandırma aynı dalda değişmişti. Belge ve kök dosya değişiklikleri ayrı bir PR olarak incelenip birleştirildi. Sonraki benzer durumlarda ekip bu ayrımı PR'ı açarken kendisi yapar.

## Kilometre taşları

| # | Aşama | Frontend | Backend | Blockchain | Çıkış kriteri |
| --- | --- | --- | --- | --- | --- |
| M0 | İskelet | ✅ | ✅ | ✅ | `typecheck`, `test` ve `forge test` yeşil (tamamlandı) |
| M1 | Bağımsız çekirdek | Host ve Sürücü ekranları mock modda (Vue 3) | Node/slot/intent/matching + MongoDB Atlas + OCPP akışı, `CHAIN_MODE=mock` | ✅ `ChargeMeshEscrow` + tüm testler | Her ekip kendi alanında demo senaryosunu mock'la oynatabilir |
| M2 | Zincir | `@wagmi/vue` ile `reserve()`, `cancel`, `withdraw()`; adres `GET /config` yanıtından (backend `getDeployment(10143)` ile doldurur) | `CHAIN_MODE=monad` (veya `anvil`): imza, confirm, `startSession`, `settle`; adres `getDeployment(10143)` ile | ✅ Anvil deploy + `chain:sync` → testnet deploy + doğrulama | Testnet üzerinde gerçek tx'lerle rezervasyon |
| M3 | Entegrasyon | `VITE_API_MODE=live` | `CHAIN_MODE=monad` | ✅ Testnet adresi `getDeployment(10143)` ile yayında | [06-demo-senaryosu.md](06-demo-senaryosu.md) testnet'te baştan sona çalışır |
| M4 | Cilalama | Proof ekranı, Türkçe hata mesajları, bekleyen ödeme uyarısı | Hata kurtarma (`settle` yeniden deneme) | ✅ Explorer doğrulaması, Monad gaz payı (`PUSH_GAS_MARGIN = 50_000`) | Demo provası |

Testnet adresi hazırdır ve `getDeployment(10143)` ile okunur; Frontend ve Backend ekipleri doğrudan testnet'le çalışabilir. Yerel Anvil isteğe bağlıdır; çevrimdışı çalışmak veya hızlı deneme yapmak isteyenler [04-akilli-sozlesme.md](04-akilli-sozlesme.md#deploy-ve-adres-yayını) belgesindeki Anvil adımlarını izleyebilir. Ekiplerin açık işleri [08-acik-isler.md](08-acik-isler.md) belgesindedir.

## Entegrasyon aşaması (tek kişi veya tek ajan)

Entegrasyon sorumlusu `integration` dalında çalışır:

```powershell
git switch -c integration main
git merge feat/contracts
git merge feat/backend
git merge feat/frontend
```

Kontrol listesi:

- [ ] Kökte `corepack pnpm install`, `corepack pnpm typecheck`, `corepack pnpm lint` ve `corepack pnpm test` yeşil.
- [ ] WSL'de `forge build` ve `forge test` yeşil.
- [ ] `chain:sync` sonrası `abi.ts` ve `deployments.ts` dosyalarında fark yok (üretilen dosyalar güncel).
- [ ] EIP-712 uyum testi yeşil. API'nin imzaladığı teklif Anvil'de `reserve()` ile kabul ediliyor.
- [ ] (İsteğe bağlı) `CHAIN_MODE=anvil` ile demo senaryosu baştan sona çalışıyor; bu, demonun yedek planıdır.
- [ ] `CHAIN_MODE=monad` ile demo senaryosu baştan sona çalışıyor; explorer bağlantıları doğru; `scripts/preflight.ps1` yeşil.
- [ ] Kısmi teslim senaryosu doğru tutarları üretiyor (0,145 / 0,055 MON).
- [ ] Frontend'deki Proof of Charge doğrulaması `verified: true` gösteriyor.
- [ ] Kök `README.md` içindeki "Hızlı başlangıç" adımları temiz bir klonda çalışıyor.

Entegrasyon sırasında yapılan düzeltmeler de sahiplik kurallarına uyar: Başka ekibin alanındaki küçük düzeltmeler `fix(<alan>): …` commit'iyle ve açıklamayla yapılır.
