# contracts: Blockchain Ajan Talimatları

Kök `AGENTS.md` kuralları geçerlidir. Bu klasörün sahibi **Blockchain** ekibidir. Bu klasör dışında yalnızca `chain:sync` ile **üretilen** `shared/src/chain/abi.ts` ve `deployments.ts` dosyalarını değiştirebilirsin.

Spesifikasyon: `docs/04-akilli-sozlesme.md`. Donmuş arayüz: `src/interfaces/IChargeMeshEscrow.sol`.

## Teknoloji

Solidity `0.8.28`, Foundry (WSL'de), OpenZeppelin Contracts 5 (`Ownable2Step`, `EIP712`, `ECDSA`, `ReentrancyGuard`), forge-std.

## Komutlar (hepsi WSL'de)

```powershell
wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && ~/.foundry/bin/forge build"
wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && ~/.foundry/bin/forge test -vvv"
wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && ~/.foundry/bin/forge fmt"
```

Worktree'de çalışıyorsan yolu kendi klasörüne göre değiştir. `forge build` sonrasında Windows tarafında şunu çalıştır:

```powershell
corepack pnpm --filter @chargemesh/shared chain:sync
```

## Kurallar

- `ChargeMeshEscrow`, `IChargeMeshEscrow` arayüzünü uygular. Arayüzü değiştirmek sözleşme değişikliği protokolüne tabidir.
- Hesaplaşma formülü `shared/src/units.ts` ile birebir aynıdır. Yuvarlama yönlerine dikkat et: depozito yukarı, Host tutarı aşağı yuvarlanır.
- Checks-effects-interactions ve `nonReentrant` kullan. Durum, transferden önce güncellenir.
- Custom error kullan, `require` ile string kullanma.
- `test/fixtures/quote-signature.json`, TypeScript tarafında `corepack pnpm --filter @chargemesh/shared fixture:quote` ile üretilir. EIP-712 uyum testi bu dosyayı okur; dosyayı elle düzenleme.
- `docs/04-akilli-sozlesme.md` içindeki "Test gereksinimleri" listesinin tamamı karşılanmadan M1 bitmiş sayılmaz.
- Deploy betiği adresi `deployments/<chainId>.json` dosyasına yazar. Testnet deploy'u ve zincire işlem gönderme **kullanıcı onayı olmadan yapılmaz**. Anvil serbesttir.
- Özel anahtarlar yalnızca ortam değişkeninden okunur (`DEPLOYER_PRIVATE_KEY`). `broadcast/` altındaki testnet kayıtlarında gizli bilgi olmadığından emin ol.

## Bitti tanımı (M1)

`forge build` ve `forge test` yeşil. Test gereksinimlerinin tamamı karşılanmış. Anvil'e deploy çalışıyor ve `chain:sync` sonrası `abi.ts` dosyası `ChargeMeshEscrow` ABI'sini içeriyor.
