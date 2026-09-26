# contracts

ChargeMesh'in zincir tarafı: `ChargeMeshEscrow` sözleşmesi. Rezervasyonu ve depozitoyu kilitler, oturum bitince aktarılan enerjiye göre ödemeyi Host ile Driver arasında paylaştırır ve oturum özetinin hash'ini kalıcı olarak kaydeder.

Konum, adres, erişim bilgisi, kişi veya araç bilgisi ve ham sayaç verisi sözleşmeye hiçbir zaman girmez.

## Kısaca nasıl çalışır?

| Adım | Fonksiyon | Kim çağırır |
| --- | --- | --- |
| Rezervasyon ve depozito | `reserve(quote, signature)` | Driver (settler imzalı teklifle) |
| Şarj başladı | `startSession(id)` | Settler (backend) |
| Şarj bitti, ödeme | `settle(id, deliveredWh, sessionHash)` | Settler |
| Başlamadan iptal | `cancel(id)` | Driver |
| Süresi dolan rezervasyon | `expire(id)` | Herkes |
| Ertelenen ödemeyi çekme | `withdraw()` | Ödemesi reddedilmiş Host veya Driver |

Ödemeler doğrudan gönderilir. Alıcı ödemeyi reddederse işlem geri alınmaz; tutar `pendingWithdrawal` hanesine yazılır ve sahibi bunu `withdraw()` ile çeker. Böylece hiçbir taraf, diğerinin ödemesini engelleyerek depozitonun tamamını geri alamaz.

Ödeme formülü:

```
billableWh = min(deliveredWh, requestedWh)
hostAmount = billableWh × pricePerKwhWei / 1000   (aşağı yuvarlanır, depozitoyu aşamaz)
refund     = depositWei − hostAmount
```

Ayrıntılı spesifikasyon: [docs/04-akilli-sozlesme.md](../docs/04-akilli-sozlesme.md). Donmuş arayüz: [src/interfaces/IChargeMeshEscrow.sol](src/interfaces/IChargeMeshEscrow.sol).

## Kurulum

Foundry Windows'ta değil, WSL (Ubuntu 24.04) içinde çalışır. Kurulum için [getfoundry.sh](https://getfoundry.sh) adımlarını izleyin. Bağımlılıklar (forge-std, OpenZeppelin) git submodule olarak gelir:

```powershell
git submodule update --init --recursive
```

Aşağıdaki komutlar PowerShell'den WSL'e aktarılır. `forge` PATH'te değilse tam yolunu (`~/.foundry/bin/forge`) kullanın.

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && ~/.foundry/bin/forge build"
wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && ~/.foundry/bin/forge test -vv"
```

## TypeScript tarafıyla uyum

Sözleşme, backend ve frontend aynı tanımları kullanmak zorundadır. Bunu iki mekanizma garanti eder:

1. **ABI ve adresler üretilir.** `forge build` sonrasında Windows tarafında `corepack pnpm --filter @chargemesh/shared chain:sync` çalıştırılır. Bu komut `shared/src/chain/abi.ts` ve `deployments.ts` dosyalarını yeniden üretir. Bu dosyalar elle düzenlenmez.
2. **EIP-712 uyum testi.** `test/fixtures/quote-signature.json`, TypeScript tarafında (`corepack pnpm --filter @chargemesh/shared fixture:quote`) imzalanmış bir tekliftir. `test/Eip712Compat.t.sol` bu imzayı sözleşmede doğrular. İki taraftan birinde tip tanımı değişirse bu test kırılır.

## Yerel zincirde deploy (Anvil)

```powershell
# 1. terminal: yerel zincir
wsl.exe -d Ubuntu-24.04 -- bash -lc "~/.foundry/bin/anvil"

# 2. terminal: deploy (anahtarları kendi shell'inizde ortam değişkeni olarak verin)
wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && ~/.foundry/bin/forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast"
```

Betik, adresi `deployments/31337.json` dosyasına yazar. Ardından `chain:sync` ile shared paket güncellenir. Yerel deploy çıktıları commit edilmez.

## Monad testnet'e deploy

> Testnet'e deploy etmeden önce ekipten onay alın. Adres değiştiğinde tüm ekiplerin çalıştığı adres de değişir.

| | |
| --- | --- |
| Chain ID | `10143` |
| RPC | `https://testnet-rpc.monad.xyz` |
| Explorer | `https://testnet.monadvision.com` |
| Faucet | `https://faucet.monad.xyz` |

```bash
forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast
forge verify-contract <adres> ChargeMeshEscrow --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Deploy sonrasında `deployments/10143.json` dosyası ve `chain:sync` ile üretilen dosyalar tek bir commit'te birleştirilir: `chore(contracts): deploy escrow to monad testnet`.

`DEPLOYER_PRIVATE_KEY` yalnızca testnet anahtarıdır ve yalnızca ortam değişkeninden okunur. `.env` dosyası hiçbir koşulda commit edilmez.

Bu klasörün çalışma kuralları için [AGENTS.md](AGENTS.md) dosyasına bakın.
