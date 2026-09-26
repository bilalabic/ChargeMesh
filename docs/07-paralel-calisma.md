# 07 · Paralel Çalışma ve Entegrasyon

> Sürüm: v1.0 · Bu belge; Frontend, Backend ve Blockchain ekiplerinin (insan ya da Claude Code/Codex ajanı fark etmeksizin) aynı anda, birbirini beklemeden ve birbirinin işini bozmadan nasıl çalışacağını tanımlar.

## Temel ilke

Ekipler birbirinin **koduna değil, sözleşmelerine** bağımlıdır. Sözleşmeler projenin başında donduruldu:

| Sözleşme | Nerede | Kimi bağlar |
| --- | --- | --- |
| REST API ve veri modelleri | `shared/src/api/` + [03-api.md](03-api.md) | Web ↔ API |
| Akıllı sözleşme arayüzü ve ABI | `contracts/src/interfaces/IChargeMeshEscrow.sol` + `shared/src/chain/abi.ts` + [04-akilli-sozlesme.md](04-akilli-sozlesme.md) | Contracts ↔ Web, API |
| EIP-712 teklif tanımı | `shared/src/chain/eip712.ts` | Contracts ↔ API ↔ Web |
| Proof of Charge ve kanonik JSON | `shared/src/proof.ts` | API ↔ Web ↔ Contracts |
| OCPP mesajları | [05-ocpp.md](05-ocpp.md) | API ↔ Simülatör |
| Demo verisi | `shared/src/fixtures/` + [06-demo-senaryosu.md](06-demo-senaryosu.md) | Herkes |

Her ekip, karşı tarafı taklit eden bir modla işe başlar:

- **Web**, `NEXT_PUBLIC_API_MODE=mock` ile fixture'lardan beslenir. Cüzdan işlemleri için yerel Anvil veya testnet kullanılabilir.
- **API**, `CHAIN_MODE=mock` ile zincire hiç dokunmadan tüm akışı çalıştırabilir. Simülatör aynı ekibe ait olduğu için OCPP tarafı hazırdır.
- **Contracts**, Foundry testleriyle tamamen bağımsızdır.

## Sahiplik

| Yol | Sahip | Diğer ekipler |
| --- | --- | --- |
| `frontend/**` | Frontend | Dokunmaz |
| `backend/api/**`, `backend/charger-sim/**` | Backend | Dokunmaz |
| `contracts/**` | Blockchain | Dokunmaz |
| `shared/src/chain/abi.ts`, `deployments.ts` | Blockchain (yalnızca `chain:sync` ile üretilir) | Dokunmaz |
| `shared/src/api/**` | Backend | Ekleme önerir |
| `shared/src/{ids,units,proof,matching}.ts`, `chain/eip712.ts` | Ortak (sözleşme dosyası) | Protokolle değiştirir |
| `shared/src/fixtures/**` | Frontend | Backend'in testleri de okuyabilir |
| `docs/**`, kök yapılandırma, `AGENTS.md`, `CLAUDE.md` | Entegrasyon sorumlusu | Öneri PR'ı açar |

## Dal ve worktree düzeni

Her ekip kendi dalında ve ayrı bir klasörde çalışır. Böylece aynı makinede üç ajan aynı anda çalışabilir:

```powershell
# Ana klasör: C:\Users\bilal\projects\ChargeMesh  (main)
git worktree add ..\ChargeMesh-frontend       -b feat/frontend
git worktree add ..\ChargeMesh-backend       -b feat/backend
git worktree add ..\ChargeMesh-contracts -b feat/contracts
```

- Her worktree'de `corepack pnpm install` ayrıca çalıştırılır.
- Ajan (Claude Code veya Codex) ilgili worktree klasöründe başlatılır. Böylece alt klasördeki `AGENTS.md`/`CLAUDE.md` dosyaları otomatik yüklenir.
- API worktree'leri aynı Atlas veritabanına eşzamanlı yazmamalıdır. Paralel API çalıştırılacaksa ayrı `MONGODB_DB_NAME`, `PORT` ve `OCPP_PORT` değerleri kullanılmalıdır.
- `main` dalına doğrudan commit atılmaz. İşler küçük PR'larla `main` dalına birleştirilir.

## Commit ve PR kuralları

- Commit mesajları **İngilizce** ve [Conventional Commits](https://www.conventionalcommits.org/) biçimindedir. Kapsam, klasör adıdır:
  - `feat(frontend): add driver intent form`
  - `feat(backend): implement deterministic slot matching`
  - `test(contracts): cover partial delivery settlement`
  - `feat(shared): add ChargingSession schema` · `docs: clarify quote expiry`
- Bir commit yalnızca bir ekibin alanına dokunur. Tek istisna, sözleşme değişikliği protokolüyle yapılan `shared` değişiklikleridir.
- PR açıklaması şablona uyar (`.github/pull_request_template.md`). CI yeşil olmadan birleştirme yapılmaz.
- `.env` dosyaları, özel anahtarlar ve seed phrase'ler **asla** commit edilmez.

## Sözleşme değişikliği protokolü

Donmuş bir sözleşmenin değiştirilmesi gerekiyorsa şu adımlar izlenir:

1. **Ekleme mi, kırıcı değişiklik mi?** Yeni opsiyonel alan veya yeni uç nokta eklemek *ekleme* sayılır. Alan silmek, yeniden adlandırmak, tip veya anlam değiştirmek ise *kırıcı değişikliktir*.
2. Değişiklik ayrı bir dalda ve tek bir PR'da yapılır: `contract/<kısa-ad>`. Bu PR şunları içerir:
   - `shared` içindeki kod değişikliği
   - İlgili `docs/0x-*.md` güncellemesi
   - [degisiklik-gunlugu.md](degisiklik-gunlugu.md) dosyasına bir satır
3. Commit türü `feat(shared)!:` (kırıcı) veya `feat(shared):` (ekleme) olur.
4. Kırıcı değişiklikler, etkilenen ekiplerin onayı alınmadan birleştirilmez. PR'da ilgili ekip etiketlenir.
5. Birleştirme sonrası diğer ekipler kendi dallarına `main`'i alır: `git merge main`.

Ajanlar için kural: **Bir ajan, kendi alanı dışındaki bir sözleşme dosyasını tek başına değiştirmez.** Değişiklik gerekiyorsa işi durdurur, gerekçeyi yazar ve bir `contract/*` PR'ı önerir.

## Kilometre taşları

| # | Aşama | Frontend | Backend | Blockchain | Çıkış kriteri |
| --- | --- | --- | --- | --- | --- |
| M0 | İskelet | ✅ | ✅ | ✅ | `typecheck`, `test` ve `forge test` yeşil (tamamlandı) |
| M1 | Bağımsız çekirdek | Host ve Driver ekranları mock modda | Node/slot/intent/matching + DB + OCPP akışı, `CHAIN_MODE=mock` | `ChargeMeshEscrow` + tüm testler | Her ekip kendi alanında demo senaryosunu mock'la oynatabilir |
| M2 | Zincir | wagmi ile `reserve()`; `cancel` | `CHAIN_MODE=anvil`: imza, confirm, `startSession`, `settle` | Anvil deploy + `chain:sync` → testnet deploy + doğrulama | Anvil üzerinde gerçek tx'lerle rezervasyon |
| M3 | Entegrasyon | `API_MODE=live` | `CHAIN_MODE=monad` | Adres yayını | [06-demo-senaryosu.md](06-demo-senaryosu.md) testnet'te baştan sona çalışır |
| M4 | Cilalama | Proof ekranı, hata mesajları, mobil QR | Hata kurtarma (`settle` yeniden deneme) | Explorer doğrulaması | Demo provası |

Blockchain ekibi M2'de adres yayınlayana kadar Web ve API ekipleri Anvil'i kendi makinelerinde `contracts/script/Deploy.s.sol` ile çalıştırabilir.

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
- [ ] `CHAIN_MODE=anvil` ile demo senaryosu baştan sona çalışıyor.
- [ ] `CHAIN_MODE=monad` ile demo senaryosu baştan sona çalışıyor; explorer bağlantıları doğru.
- [ ] Kısmi teslim senaryosu doğru tutarları üretiyor (0,145 / 0,055 MON).
- [ ] Web'deki Proof of Charge doğrulaması `verified: true` gösteriyor.
- [ ] Kök `README.md` içindeki "Hızlı başlangıç" adımları temiz bir klonda çalışıyor.

Entegrasyon sırasında yapılan düzeltmeler de sahiplik kurallarına uyar: Başka ekibin alanındaki küçük düzeltmeler `fix(<alan>): …` commit'iyle ve açıklamayla yapılır.
