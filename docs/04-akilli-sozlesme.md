# 04 · Akıllı Sözleşme: `ChargeMeshEscrow`

> Sürüm: v1.1 · Sahibi: Blockchain ekibi
>
> **Tek doğruluk kaynağı** `contracts/src/interfaces/IChargeMeshEscrow.sol` dosyasıdır. Frontend ve backend'in kullandığı ABI bu arayüzden üretilir ve `shared/src/chain/abi.ts` dosyasına yazılır. Arayüz değişirse ABI yeniden üretilmeden commit yapılmaz.

## Amaç

Sözleşmenin üç görevi vardır:

1. Backend'in (settler) imzaladığı bir teklifle **rezervasyonu ve depozitoyu** zincire kilitlemek
2. Oturum bittiğinde **aktarılan enerjiye göre** depozitoyu Host ile Sürücü arasında paylaştırmak
3. Oturum özetinin **hash'ini** (Proof of Charge) kalıcı olarak kaydetmek

Konum, adres, erişim bilgisi, kişi veya araç bilgisi ve ham sayaç verisi sözleşmeye **girmez**.

## Güven modeli

- **Settler**, backend'in tuttuğu tek bir EOA'dır. Hem teklifleri imzalar hem de `startSession` ve `settle` çağrılarını yapar.
- Sürücü, settler'ın imzaladığı bir teklif olmadan rezervasyon açamaz. Bu sayede fiyat, Host adresi, enerji miktarı ve zaman penceresi backend'in onayladığı değerlerle sınırlı kalır.
- Oturum sonucunu settler bildirir. Bu bir **güven varsayımıdır**: Sözleşme, sayaç verisinin doğruluğunu kanıtlayamaz; yalnızca beyan edilen sonucu ve bu sonucun hash'ini kayda geçirir. Settler'ın kötüye kullanım alanı sınırlıdır: En fazla `depositWei` kadar tutarı Host'a yönlendirebilir.
- Backend çökerse sürücünün parası kilitli kalmaz. `expire()` çağrısı herkese açıktır ve süre dolduğunda depozitoyu iade eder.
- Hiçbir taraf diğerinin ödemesini engelleyemez. Alıcı ödemeyi reddederse tutar kaybolmaz: Alıcının çekilebilir bakiyesine (`pendingWithdrawal`) eklenir, sahibi de bunu `withdraw()` ile çeker (bkz. [Ödeme modeli](#ödeme-modeli)).
- Settler anahtarı ele geçirilirse zarar, sözleşmede kilitli depozitolarla sınırlıdır ve para yalnızca teklifte yazan Host'a gidebilir. Owner `setSettler` ile anahtarı değiştirdiğinde, eski anahtarla imzalanmış ama henüz kullanılmamış tüm teklifler de geçersiz olur.
- Settler `startSession` çağrısını `startTime` öncesinde de yapabilir. Bu durumda sürücü artık `cancel` edemez. Sözleşme buna izin verir; zaman kontrolü backend'de yapılır (`[startsAt − 15 dk, endsAt]`, bkz. `docs/03-api.md`).

## Tipler

```solidity
enum Status { None, Reserved, Active, Settled, Cancelled, Expired }

struct ReservationQuote {
    bytes32 reservationId;   // keccak256("reservation:" + uuid)
    bytes32 slotRef;         // keccak256("slot:" + uuid)
    address driver;
    address host;
    uint32  requestedWh;
    uint128 pricePerKwhWei;
    uint128 depositWei;
    uint64  startTime;       // unix saniye
    uint64  endTime;
    uint64  quoteExpiry;
}

struct Reservation {
    bytes32 slotRef;
    address driver;
    address host;
    uint32  requestedWh;
    uint32  deliveredWh;
    uint128 pricePerKwhWei;
    uint128 depositWei;
    uint64  startTime;
    uint64  endTime;
    Status  status;
    bytes32 sessionHash;
}
```

## EIP-712

| Alan | Değer |
| --- | --- |
| `name` | `"ChargeMesh"` |
| `version` | `"1"` |
| `chainId` | Deploy edilen zincir |
| `verifyingContract` | Sözleşme adresi |

```
ReservationQuote(bytes32 reservationId,bytes32 slotRef,address driver,address host,uint32 requestedWh,uint128 pricePerKwhWei,uint128 depositWei,uint64 startTime,uint64 endTime,uint64 quoteExpiry)
```

TypeScript karşılığı `shared/src/chain/eip712.ts` dosyasındadır (`reservationQuoteTypes`, `getEip712Domain`). Backend `signTypedData`, sözleşme ise OpenZeppelin `EIP712` ve `ECDSA` kullanır. Sözleşmedeki type string'i ile TypeScript tanımı karakteri karakterine aynı olmalıdır. Blockchain ekibi bunu bir Foundry testiyle doğrular (bkz. [Test gereksinimleri](#test-gereksinimleri)).

## Fonksiyonlar

| Fonksiyon | Kim çağırır | Koşullar | Sonuç |
| --- | --- | --- | --- |
| `reserve(ReservationQuote q, bytes sig) payable` | Sürücü (`q.driver`) | `msg.sender == q.driver` · `msg.value == q.depositWei` · `block.timestamp <= q.quoteExpiry` · `q.startTime < q.endTime` · `q.requestedWh > 0` · `q.host != 0` · `q.depositWei == ceilDiv(q.requestedWh × q.pricePerKwhWei, 1000)` · imzalayan == `settler` · rezervasyon `None` · `slotRef` boşta | `Reserved`, `slotTaken[slotRef] = true`, `ReservationCreated` |
| `startSession(bytes32 id)` | Settler | Durum `Reserved` · `block.timestamp <= endTime` | `Active`, `SessionStarted` |
| `settle(bytes32 id, uint32 deliveredWh, bytes32 sessionHash)` | Settler | Durum `Active` · `sessionHash != 0` | `Settled`, Host'a `hostAmount`, Sürücü'ye `refund` gönderilir, `ReservationSettled` |
| `cancel(bytes32 id)` | Sürücü | Durum `Reserved` · `block.timestamp < startTime` | `Cancelled`, depozitonun tamamı iade edilir, slot serbest kalır, `ReservationCancelled` |
| `expire(bytes32 id)` | Herkes | (`Reserved` ve `block.timestamp > endTime`) **veya** (`Active` ve `block.timestamp > endTime + SETTLEMENT_GRACE`) | `Expired`, depozitonun tamamı Sürücü'ye iade edilir, slot serbest kalır, `ReservationExpired` |
| `withdraw()` | Bekleyen alacağı olan herkes | `pendingWithdrawal(msg.sender) > 0`, aksi halde `NothingToWithdraw` | Alacak sıfırlanır, tamamı gönderilir, `Withdrawn`. Gönderim başarısız olursa `TransferFailed` ile revert eder ve alacak korunur. |
| `setSettler(address)` | Owner | `address != 0` | `SettlerUpdated` |
| `renounceOwnership()` | Owner | Her zaman `RenounceDisabled` | Kapalıdır; owner'sız bir sözleşmede settler bir daha değiştirilemezdi. |
| `pendingWithdrawal(address)` | view | | Hesabın çekilmeyi bekleyen alacağı (wei) |
| `getReservation(bytes32)` | view | | `Reservation` |
| `isSlotTaken(bytes32)` | view | | `bool` |
| `settler()` | view | | `address` |
| `hashQuote(ReservationQuote)` | view | | EIP-712 digest (hata ayıklama için) |
| `SETTLEMENT_GRACE()` | view | | `1 days` |

**Hesaplaşma formülü** (`shared/src/units.ts` ile birebir aynı):

```
billableWh  = min(deliveredWh, requestedWh)
hostAmount  = min(billableWh * pricePerKwhWei / 1000, depositWei)   // aşağı yuvarlama
refund      = depositWei - hostAmount
```

### Ödeme modeli

`settle`, `cancel` ve `expire` çağrılarında ödemeler önce doğrudan gönderilir (push). Durum değişikliği gönderimden **önce** yapılır (checks-effects-interactions) ve tüm fonksiyonlar `nonReentrant` korumasına sahiptir.

Gönderim 100.000 gaz sınırıyla (`PUSH_GAS_LIMIT`) ve dönüş verisi kopyalanmadan yapılır. Alıcı ödemeyi reddederse (kodlu bir cüzdan, EIP-7702 ile yetkilendirilmiş bir EOA veya kasıtlı olarak revert eden bir sözleşme) işlem **geri alınmaz**. Tutar alıcının çekilebilir bakiyesine (`pendingWithdrawal`) eklenir, `PaymentDeferred` olayı yayılır ve alıcı parasını daha sonra `withdraw()` ile çeker.

Ertelemenin yalnızca alıcının kendi hatasından kaynaklanması gerekir, çağıranın değil. EVM'de bir alt çağrıya kalan gazın en fazla 63/64'ü iletilebilir. Bu yüzden herkese açık `expire` bilerek düşük gazla çağrılırsa, kodlu bir alıcıya yapılan ödeme yapay olarak başarısız kılınabilirdi. Bunu önlemek için sözleşme her gönderimden önce şu koşulu arar:

```
gasleft() >= PUSH_GAS_LIMIT * 64 / 63 + PUSH_GAS_MARGIN
          =  100000 * 64 / 63 + 50000     // ≈ 151.587 gaz
```

Koşul sağlanmazsa ödeme ertelenmez, işlem `InsufficientGas` ile geri alınır.

**`PUSH_GAS_MARGIN` neden 50.000?** `CALL` işleminin kendi maliyeti, alt çağrıya iletilen paydan önce kalan gazdan düşülür. Monad'da soğuk hesap erişimi 10.100 gazdır (Ethereum'da 2.600). Buna değer taşıyan çağrı için 9.000, daha önce hiç kullanılmamış bir hesaba gönderim için de 25.000 gaz eklenir. En kötü durumda, yani yeni bir hesaba yapılan ilk gönderimde toplam **10.100 + 9.000 + 25.000 = 44.100 gaz** eder. İlk sürümdeki 40.000'lik pay Monad'da bu tutarı karşılamıyordu; 50.000 yeterli boşluk bırakır. Bu değişiklik yeni bir deploy gerektirdi: Güncel testnet adresi `{{ESCROW_ADDRESS}}`, deploy bloğu `{{DEPLOY_BLOCK}}`. Kodda adres her zaman `getDeployment(10143)` ile okunur.

Bu model neden gerekli? Salt push modelinde, iadeyi reddeden bir sürücü `settle` çağrısını tamamen engelleyebilir, ardından `SETTLEMENT_GRACE` sonunda `expire` ile depozitonun tamamını geri alabilirdi. Yani şarj bedava olurdu. Yuvarlama nedeniyle iade çoğu zaman en az 1 wei olduğundan bu saldırı gerçekçidir. "Gönder, olmazsa alacak yaz" modeli bu yolu kapatır: Host'un ödemesi, sürücünün cüzdanı ne yaparsa yapsın gerçekleşir.

Frontend, bağlı cüzdanın `pendingWithdrawal(adres)` değeri sıfırdan büyükse "Bekleyen ödemeniz var" uyarısını ve `withdraw()` düğmesini gösterir. Backend çekim yapmaz ve kullanıcıya düğme göstermez; `settle` receipt'inde (veya `sync` sırasında) gördüğü `PaymentDeferred` olaylarını yalnızca loglar.

## Olaylar

```solidity
event ReservationCreated(
    bytes32 indexed reservationId, bytes32 indexed slotRef, address indexed driver,
    address host, uint32 requestedWh, uint128 pricePerKwhWei, uint128 depositWei,
    uint64 startTime, uint64 endTime
);
event SessionStarted(bytes32 indexed reservationId, uint64 startedAt);
event ReservationSettled(
    bytes32 indexed reservationId, uint32 deliveredWh, uint32 billableWh,
    uint128 hostAmountWei, uint128 refundWei, bytes32 sessionHash
);
event ReservationCancelled(bytes32 indexed reservationId, uint128 refundWei);
event ReservationExpired(bytes32 indexed reservationId, uint128 refundWei);
event SettlerUpdated(address indexed previousSettler, address indexed newSettler);
event PaymentDeferred(address indexed account, uint256 amount);
event Withdrawn(address indexed account, uint256 amount);
```

## Hatalar

`NotDriver()`, `NotSettler()`, `InvalidQuote()`, `QuoteExpired()`, `InvalidSignature()`, `IncorrectDeposit()`, `ReservationExists()`, `SlotAlreadyTaken()`, `InvalidStatus(Status current)`, `TooLate()`, `TooEarly()`, `ZeroSessionHash()`, `TransferFailed()` (yalnızca `withdraw`), `ZeroAddress()`, `NothingToWithdraw()`, `RenounceDisabled()`, `InsufficientGas()`.

Frontend, bu hataları ABI üzerinden çözümleyip kullanıcıya Türkçe mesajla gösterir.

### Hangi durumda hangi hata?

Kontroller aşağıdaki sırayla yapılır; ilk başarısız kontrolün hatası döner.

| Fonksiyon | Sıra ve hata |
| --- | --- |
| `reserve` | 1. `msg.sender != q.driver` → `NotDriver` · 2. `block.timestamp > q.quoteExpiry` → `QuoteExpired` · 3. `q.startTime >= q.endTime` veya `q.requestedWh == 0` veya `q.host == 0` → `InvalidQuote` · 4. `q.depositWei != ceilDiv(...)` veya `msg.value != q.depositWei` → `IncorrectDeposit` · 5. imzalayan settler değil → `InvalidSignature` · 6. rezervasyon zaten var → `ReservationExists` · 7. `slotTaken[q.slotRef]` → `SlotAlreadyTaken` |
| `startSession` | `NotSettler` → durum `Reserved` değil: `InvalidStatus(current)` → `block.timestamp > endTime`: `TooLate` |
| `settle` | `NotSettler` → durum `Active` değil: `InvalidStatus(current)` → `sessionHash == 0`: `ZeroSessionHash` |
| `cancel` | durum `Reserved` değil: `InvalidStatus(current)` → çağıran sürücü değil: `NotDriver` → `block.timestamp >= startTime`: `TooLate` |
| `expire` | durum `Reserved` veya `Active` değil: `InvalidStatus(current)` → süre henüz dolmadı: `TooEarly` |

### Slotun yeniden kullanımı

`slotTaken[slotRef]` yalnızca `cancel` ve `expire` ile serbest kalır. `settle` sonrasında slot **dolu kalır**, çünkü bir Energy Slot yalnızca bir rezervasyon alır ve tamamlanan bir slot yeniden satılmaz. Host yeni kapasite için yeni bir slot yayınlar.

### Deploy bloğu

`deployments/<chainId>.json` içindeki `deployBlock`, betiğin çalıştığı andaki `block.number` değeridir ve gerçek deploy bloğunun **alt sınırıdır**. Event taraması bu bloktan başlatılabilir; kesin blok gerekmez.

## Sahiplik ve yükseltme

- `Ownable2Step` kullanılır. Owner yalnızca `setSettler` çağırabilir.
- Sözleşme yükseltilebilir **değildir**. Değişiklik gerekirse yeni sürüm deploy edilir ve `deployments.ts` güncellenir.
- Platform komisyonu, pause ve token desteği yoktur (kapsam dışı).

## Test gereksinimleri

Blockchain ekibi en az şu Foundry testlerini yazar:

- `reserve` için mutlu yol ve her `revert` koşulu (yanlış imzalayan, yanlış depozito, süresi geçmiş teklif, tekrar kullanılan `reservationId`, dolu `slotRef`, `msg.sender != driver`)
- `startSession` ve `settle`: tam teslim, kısmi teslim (`delivered < requested`), fazla teslim (`delivered > requested`) ve `delivered = 0` durumları. Bakiyeler wei'si wei'sine doğrulanır.
- `cancel` ve `expire` için zaman sınırları (`vm.warp`)
- Reentrancy: Host adresi kötü niyetli bir sözleşme olduğunda `settle` yeniden giriş yapamaz.
- Ödeme reddi: Ödemeyi reddeden, sonsuz döngüye giren veya yeniden girmeye çalışan bir Host ya da Sürücü, diğer tarafın ödemesini engelleyemez. Tutar alıcının `pendingWithdrawal` bakiyesine eklenir ve `withdraw()` ile çekilebilir.
- Gaz koruması: `expire` gibi herkese açık bir çağrı bilerek düşük gazla yapılırsa, ödeme ertelemeye zorlanmaz; işlem `InsufficientGas` ile geri alınır.
- `withdraw`: `NothingToWithdraw`, başarılı çekim, çift çekim denemesi.
- **EIP-712 uyumu:** `shared` ile üretilen örnek bir imza (sabit anahtar, sabit teklif, `test/fixtures/quote-signature.json`) sözleşme tarafından doğrulanmalıdır. Bu test, TypeScript ile Solidity tanımlarının birbirinden ayrışmasını önler.
- Fuzz: Rastgele `requestedWh`, `deliveredWh` ve `pricePerKwhWei` değerlerinde `hostAmount + refund == deposit` her zaman sağlanmalıdır. Ödemesi ertelenen alıcılar olduğunda da sözleşme bakiyesi, açık depozitolar ile bekleyen alacakların toplamına eşit kalmalıdır.

## Deploy ve adres yayını

Güncel testnet dağıtımı: escrow `{{ESCROW_ADDRESS}}`, deploy bloğu `{{DEPLOY_BLOCK}}`, settler `0x10562C789bB833c1930cdc7115D4fC0C4D32BA73`. Kod bu değerleri elle değil, `getDeployment(10143)` ile okur.

1. **Yerel (Anvil):** WSL'de ayrı bir terminalde `anvil` başlatılır ve demo ya da test boyunca **açık bırakılır**; terminal kapanırsa zincir ve deploy silinir. `forge`, `contracts/.env` dosyasını kendiliğinden yükler. Oradaki `DEPLOYER_PRIVATE_KEY` testnet anahtarıdır ve Anvil'de bakiyesi yoktur; `SETTLER_ADDRESS` doluysa settler da yanlış adrese atanır. Bu yüzden Anvil deploy'unda Anvil'in 0 numaralı hesabının anahtarı komut satırında açıkça verilir ve `SETTLER_ADDRESS` boşaltılır. Komut satırında verilen değer `.env` dosyasındakini ezer:

   ```powershell
   wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 SETTLER_ADDRESS= ~/.foundry/bin/forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast"
   ```

   Bu anahtar Anvil'in herkesçe bilinen test anahtarıdır; yalnızca yerel zincirde kullanılır. Deploy sonucu `deployments/31337.json` dosyasına yazılır. Bu dosya `.gitignore` kapsamındadır ve commit edilmez. `chain:sync` 31337'yi varsayılan olarak atlar; yerel adresi `deployments.ts` dosyasına almak için `--include-local` bayrağı verilir: `corepack pnpm --filter @chargemesh/shared chain:sync --include-local`. Bu çıktı da commit edilmez.
2. **Testnet:** `--rpc-url https://testnet-rpc.monad.xyz` kullanılır; anahtar `contracts/.env` dosyasından okunur. Deploy betiği adresi simülasyon aşamasında yazar. Bu yüzden `chain:sync` öncesinde adreste gerçekten kod olduğu doğrulanır; çıktı `0x` ise deploy zincire ulaşmamıştır:

   ```bash
   cast code <adres> --rpc-url https://testnet-rpc.monad.xyz
   forge verify-contract <adres> ChargeMeshEscrow --chain 10143 \
     --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
   ```

3. Deploy betiği adresi, settler'ı ve blok numarasını `contracts/deployments/<chainId>.json` dosyasına yazar (`{ "chainId", "escrow", "settler", "deployBlock" }`).
4. Ardından Windows tarafında `corepack pnpm --filter @chargemesh/shared chain:sync` çalıştırılır. Bu komut `contracts/out/` altındaki ABI'yi `shared/src/chain/abi.ts`, deploy JSON'larını da `shared/src/chain/deployments.ts` dosyasına yazar. Üretilen dosyalar elle düzenlenmez.
5. Adres değişikliği tek başına bir commit olur: `chore(contracts): deploy escrow to monad testnet`.

`DEPLOYER_PRIVATE_KEY` ve `SETTLER_PRIVATE_KEY` yalnızca testnet anahtarlarıdır. Hiçbir koşulda commit edilmez ve mainnet'te kullanılmaz.

## Monad'a özgü notlar

Monad, EVM ile bayt kodu düzeyinde uyumludur ama birkaç noktada Ethereum'dan farklı davranır. Aşağıdaki kurallar Monad testnet'i (Monad v0.16.x, `MONAD_TEN` revizyonu) için geçerlidir; ayrıntılar resmi belgelerde:

- **Ücret, harcanan gaza göre değil gaz *limitine* göre alınır.** `ücret = gas limit × gas fiyatı`; kullanılmayan gaz iade edilmez ([gas-pricing](https://docs.monad.xyz/developer-essentials/gas-pricing.md)). Bu yüzden:
  - Frontend, cüzdana gaz limitini açıkça verir: `estimateContractGas` sonucu + %10. Göndermeden önce `simulateContract` ile işlemi dener; revert edecek bir işlem cüzdana hiç gönderilmez.
  - Settler, her fonksiyon için sabit bir gaz limiti kullanır. Bu limitler **Anvil'de değil, testnet'te** ölçülür. Monad bazı işlemleri farklı fiyatlandırır: soğuk hesap erişimi 10.100 gaz, `ecrecover` 6.000 gaz; depolama erişimi de sayfa temelli fiyatlandırılır ([opcode-pricing](https://docs.monad.xyz/developer-essentials/opcode-pricing.md)). Anvil'de ölçülen değerler Monad'da yetersiz kalabilir.
- **Reserve balance kuralı: 10 MON.** Monad, her hesabın bakiyesinde gaz ödemeleri için 10 MON'luk bir tampon arar ([reserve-balance](https://docs.monad.xyz/developer-essentials/reserve-balance.md)). Bir işlem bakiyeyi azaltıp 10 MON'un altına düşürürse revert edebilir; son birkaç bloktaki işlemlerin toplam ücreti bu tamponu aşarsa işlem konsensüste reddedilir. Pratik sonuçları:
  - Sürücü cüzdanında `depozito + ücret + 10 MON` kadar bakiye bulunmalıdır. Frontend bu koşul sağlanmıyorsa `reserve()` öncesinde uyarı gösterir.
  - Settler cüzdanında en az 11 MON (10 MON tampon + gaz) tutulur.
  - Cüzdana MON yüklendikten sonra `reserve()` göndermeden önce 1–2 saniye beklenir. Konsensüs, bakiyeyi birkaç blok geriden görür.
- **Kesinlik (finality).** Monad'da blok önce önerilir, sonra kesinleşir. `latest` etiketiyle dönen receipt spekülatif olabilir ([block-states](https://docs.monad.xyz/monad-arch/consensus/block-states.md)). Backend, `confirm` doğrulamasında ve settler işlemlerinden sonra, veritabanındaki durumu değiştirmeden önce `waitForFinalized` yardımcısıyla işlemin kesinleşmesini bekler (yaklaşık 600 ms).
- **Log sorguları.** Herkese açık RPC'ler `eth_getLogs` için blok aralığını sınırlar (ör. 100 blok). `eth_newFilter` gibi filtre RPC'leri desteklenmez ([json-rpc](https://docs.monad.xyz/reference/json-rpc/overview.md)). Olay taraması için `shared` içindeki parçalı (chunked) yardımcılar kullanılır; güncel durum için olay taraması yerine `getReservation` okunur. viem'in `watchContractEvent` gibi filtreye dayalı izleyicileri kullanılmaz.
- **Nonce.** Monad'da `pending` etiketi `latest` ile aynı davranır; havuzdaki işlemler nonce hesabına katılmaz. Settler işlemleri bu yüzden tek bir sıradan (serialized queue) ya da viem'in `nonceManager`'ı ile gönderilir. Aynı anda gönderilen iki işlem aynı nonce'u alır.
- **EIP-7702 etkin.** Bir EOA, kodu olan bir hesaba dönüşebilir ([eip-7702](https://docs.monad.xyz/developer-essentials/eip-7702.md)). Yani Host veya Sürücü adresinin ödemeyi reddetmesi mümkündür. Sözleşmedeki "gönder, olmazsa alacağa ekle" modeli (bkz. [Ödeme modeli](#ödeme-modeli)) bu riski karşılar.
- Genel öneriler için [best-practices](https://docs.monad.xyz/developer-essentials/best-practices.md), güncel ağ bilgileri için [current-facts](https://docs.monad.xyz/ai/current-facts.md) sayfalarına bakın.

## Entegrasyon rehberi

Bu bölüm, frontend ve backend'in sözleşmeyle nasıl konuşacağını kısa örneklerle anlatır. Kullanılan yardımcıların hepsi `@chargemesh/shared` paketindedir (`shared/src/chain/`). ABI'yi, adresleri, hata çözümlemeyi ve durum dönüşümünü kendi tarafınızda yeniden yazmayın.

**Adres kuralı:** Sözleşme adresi ve deploy bloğu her zaman `getDeployment(chainId)` ile alınır. Testnet için bu çağrı `getDeployment(10143)`, yani `getDeployment(monadTestnet.id)` olur. Adres hiçbir yere elle yazılmaz; yeni bir deploy sonrasında `chain:sync` çalıştırmak yeterlidir.

| Yardımcı | Ne işe yarar |
| --- | --- |
| `buildQuoteTypedData`, `quoteToContractArgs` | Teklifi EIP-712 imzası ve `reserve()` argümanı için hazırlar |
| `findReservationCreated(receipt, reservationId, escrow)` | Receipt içinde, escrow adresinden yayılmış `ReservationCreated` olayını bulur; bulamazsa `null` döner. Receipt durumu viem'in `"success"` değeri de olabilir, ham JSON-RPC'deki `"0x1"` de. |
| `waitForFinalized(client, { hash })` | İşlemin bloğu kesinleşene kadar bekler (Monad'da yaklaşık 600 ms) ve kesinleşmiş receipt'i döner. Receipt henüz yoksa onu da bekler; süre dolarsa `FinalityTimeoutError`, blok değişmişse `ReorgDetectedError` fırlatır. `confirm` doğrulamasında ve her settler işleminden sonra, veritabanı güncellenmeden önce çağrılır (bkz. [Monad'a özgü notlar](#monada-özgü-notlar)). |
| `parseEscrowEvents(logs, { escrow? })` | Loglardaki escrow olaylarını tipli olarak çözer |
| `fetchLogsChunked(client, { … })` | `eth_getLogs` sorgusunu 100 bloklık parçalara bölerek çalıştırır, geçici RPC hatalarında yeniden dener. Kendi tarayıcınızı yazıyorsanız bunu kullanın; `onProgress` ile işlenen son bloğu kaydedebilirsiniz |
| `getEscrowEventsForReservation(client, { escrow, reservationId, fromBlock?, toBlock? })` | Bir rezervasyonun tüm olaylarını eskiden yeniye getirir. Sorguyu varsayılan olarak 100 bloklık parçalara böler (`maxBlockRange`). `fromBlock` verilmezse `deployBlock` kullanılır; `deployments.ts` içinde bulunmayan bir escrow için `fromBlock` zorunludur. |
| `OnchainStatus`, `onchainStatusName`, `onchainStatusToReservationStatus` | Zincirdeki `Status` değerini adına ve API'deki `ReservationStatus` karşılığına çevirir |
| `decodeEscrowError(err)`, `ESCROW_ERROR_MESSAGES_TR` | viem/wagmi hatalarının içinden sözleşme hatasını çıkarır ve kullanıcıya gösterilecek Türkçe mesajı verir |
| `explorerTxUrl(chainId, hash)` | Monad testnet'te explorer bağlantısı üretir; diğer zincirlerde `null` döner |

`ESCROW_ERROR_MESSAGES_TR`, ABI'deki hata adlarına göre tip kontrolünden geçer. ABI'ye yeni bir hata eklenip mesajı yazılmazsa `shared` paketinin `typecheck` adımı kırılır.

Bu yardımcıların yerel kopyaları yazılmaz. Backend veya frontend içinde aynı işi yapan bir fonksiyon varsa `shared`'dakiyle değiştirilir.

### Backend

**Teklifi imzalamak.** `POST /reservations` içinde teklif settler anahtarıyla imzalanır:

```ts
import { buildQuoteTypedData, getDeployment } from "@chargemesh/shared";

const deployment = getDeployment(chainId); // Monad testnet için 10143
if (!deployment) throw new Error(`No escrow deployment for chain ${chainId}`);

const signature = await settlerWallet.signTypedData(
  buildQuoteTypedData(quote, chainId, deployment.escrow),
);
```

**`confirm` doğrulaması.** Receipt başarılı olmalı, `to` alanı escrow adresini göstermeli ve loglarda bu rezervasyona ait bir `ReservationCreated` bulunmalıdır. `findReservationCreated`, başka bir sözleşmenin yaydığı aynı imzalı olayları ve başarısız receipt'leri kendisi eler. Receipt spekülatif olabileceği için rezervasyon, işlem kesinleştikten sonra `CONFIRMED` yapılır:

```ts
import { findReservationCreated, waitForFinalized } from "@chargemesh/shared";
import { isAddressEqual, type Hex } from "viem";

// Kesinleşmiş receipt: işlem henüz bloğa girmediyse onu da bekler.
const receipt = await waitForFinalized(publicClient, { hash: txHash as Hex, timeoutMs: 30_000 });
const created =
  receipt.to && isAddressEqual(receipt.to, deployment.escrow)
    ? findReservationCreated(receipt, reservation.onchainId as Hex, deployment.escrow)
    : null;
if (!created) throw new ApiError("CHAIN_VERIFICATION_FAILED");

// Olaydaki değerler saklanan teklifle aynı olmalı.
const matches =
  created.args.slotRef === quote.slotRef &&
  isAddressEqual(created.args.driver, quote.driver as Hex) &&
  created.args.depositWei === BigInt(quote.depositWei);
if (!matches) throw new ApiError("CHAIN_VERIFICATION_FAILED");
// Ancak bundan sonra: rezervasyon CONFIRMED, slot RESERVED.
```

İşlem henüz bloğa girmediyse `getTransactionReceipt` bir `TransactionReceiptNotFoundError` fırlatır. `waitForFinalized` ise receipt'i de bekler; bu yüzden kısa bir zaman aşımıyla onu kullanmak hem daha sağlam hem de spekülatif receipt'e karşı güvenlidir. `confirm` idempotent olduğu için istemci aynı hash'le tekrar çağırabilir.

**`startSession` ve `settle`.** İşlemi göndermeden önce `simulateContract` ile denemek, olası bir revert'ü gaz harcamadan ve okunabilir bir hatayla yakalamayı sağlar. Monad ücreti gaz limitine göre aldığı için settler, testnet'te ölçülmüş sabit bir gaz limiti verir (bkz. [Monad'a özgü notlar](#monada-özgü-notlar)). Gönderim, settler işlemlerini tek tek gönderen sıranın içinde yapılır:

```ts
import { chargeMeshEscrowAbi, waitForFinalized } from "@chargemesh/shared";
// Backend'in kendi sabitleri: testnet'te ölçülmüş limit + pay. Anvil ölçümü kullanılmaz.
import { SETTLE_GAS_LIMIT } from "./gas-limits";
// settlerQueue: settler işlemlerini tek tek gönderen backend içi sıra (veya viem nonceManager).

const { request } = await publicClient.simulateContract({
  account: settlerAccount,
  address: deployment.escrow,
  abi: chargeMeshEscrowAbi,
  functionName: "settle", // startSession için: functionName: "startSession", args: [onchainId]
  args: [onchainId, deliveredWh, sessionHash],
  gas: SETTLE_GAS_LIMIT,
});
const hash = await settlerQueue.run(() => settlerWallet.writeContract(request));
const receipt = await waitForFinalized(publicClient, { hash }); // DB bundan sonra güncellenir
```

**`settle` başarısız olursa.** Rezervasyon `FAILED` durumuna geçer, oturumun SSE akışına `session.error` olayı gönderilir ve işlem yeniden denenebilir (bkz. `docs/02-mimari.md`). Tekrar denemeden önce zincirdeki durumu okuyun; önceki işlem aslında başarıyla bloğa girmiş olabilir:

- `getReservation` durumu `Settled` gösteriyorsa (ya da `decodeEscrowError` bir `InvalidStatus` döndürdüyse ve durum `Settled` ise) işlemi yeniden göndermeyin. `getEscrowEventsForReservation` ile `ReservationSettled` olayını bulun, tx hash'ini ve tutarları oradan alın, rezervasyonu `SETTLED` yapın.
- Durum `Expired` ise `SETTLEMENT_GRACE` dolmuş ve biri `expire()` çağırmıştır. Rezervasyon `EXPIRED` olur, yeniden deneme yapılmaz.
- Durum hâlâ `Active` ise aynı `deliveredWh` ve `sessionHash` ile tekrar gönderin. Bu değerler deterministik olduğu için tekrar denemek güvenlidir. Ağ, nonce veya gaz kaynaklı hatalarda artan beklemeyle (backoff) birkaç deneme yeterlidir.
- `NotSettler`, settler anahtarının değiştiğini; `ZeroSessionHash` ise backend'de bir hata olduğunu gösterir. Bu iki durumda otomatik deneme yapılmaz, hata loglanır.
- Settler tek bir EOA'dır ve Monad'da `pending` etiketi `latest` ile aynı davranır. Bu yüzden işlemler tek bir sıradan ya da viem'in `nonceManager`'ı ile gönderilir. Aynı anda gönderilen iki işlem aynı nonce'u alır.

**`sync`.** `POST /reservations/:id/sync`, zincirdeki güncel durumu okuyup API durumuna çevirir:

```ts
import { chargeMeshEscrowAbi, onchainStatusToReservationStatus } from "@chargemesh/shared";

const onchain = await publicClient.readContract({
  address: deployment.escrow,
  abi: chargeMeshEscrowAbi,
  functionName: "getReservation",
  args: [reservation.onchainId as Hex],
});
const next = onchainStatusToReservationStatus(onchain.status); // None → null
```

`null`, rezervasyonun zincirde henüz bulunmadığı anlamına gelir; bu durumda mevcut durum korunur. `PENDING_PAYMENT`, `HOLD_EXPIRED`, `COMPLETED` ve `FAILED` yalnızca backend'de yaşayan durumlardır ve zincirde karşılıkları yoktur. Oturum bittikten sonra da rezervasyon zincirde `Active` görünmeye devam eder. Bu yüzden `COMPLETED` veya `FAILED` durumundaki bir rezervasyon `sync` ile `ACTIVE`'e geri çekilmez; bu durumları yalnızca `Settled`, `Cancelled` ve `Expired` gibi son durumlar ezer.

**Bekleyen ödemeler.** Ödemeyi reddeden alıcının tutarı `pendingWithdrawal` bakiyesine eklenir (bkz. [Ödeme modeli](#ödeme-modeli)). Backend bu durumu yalnızca loglar; kullanıcıya uyarıyı frontend gösterir. `settle` receipt'indeki `PaymentDeferred` olaylarını şöyle bulabilirsiniz:

```ts
import { parseEscrowEvents } from "@chargemesh/shared";

const deferred = parseEscrowEvents(receipt.logs, { escrow: deployment.escrow }).filter(
  (e) => e.eventName === "PaymentDeferred",
);
for (const e of deferred) log.warn({ account: e.args.account, amount: e.args.amount }, "payment deferred");
```

**Olay taraması.** `getEscrowEventsForReservation`, `fromBlock` verilmediğinde taramaya `deployBlock` değerinden başlar ve sorguyu 100 bloklık parçalara böler; herkese açık Monad RPC'leri daha geniş aralıkları reddeder. Monad'da blok süresi kısa olduğundan deploy bloğundan bugüne tarama çok sayıda istek demektir. Bu yüzden güncel durumu öğrenmek için olay taraması yerine `getReservation` okunur; olay taraması yalnızca tx hash'i veya tutar gibi geçmiş bilgiler gerektiğinde, mümkünse dar bir `fromBlock` ile yapılır. Sürekli bir tarayıcı gerekiyorsa son işlenen blok veritabanında saklanır ve tarama oradan devam eder.

### Frontend

Frontend Vue 3 ile yazılır ve cüzdan işlemleri için `@wagmi/vue` kullanır. Örneklerdeki `publicClient`, `shared` içindeki zincir tanımıyla oluşturulmuş bir viem istemcisidir:

```ts
import { supportedChains } from "@chargemesh/shared";
import { createPublicClient, http } from "viem";

const chain = supportedChains.find((c) => c.id === config.chainId)!; // GET /config yanıtından
export const publicClient = createPublicClient({ chain, transport: http() });
```

**Rezervasyon (`reserve`).** Adres ve zincir bilgisi `POST /reservations` yanıtındaki `contractAddress` ve `chainId` alanlarından gelir; backend bu değerleri `getDeployment` ile doldurur. Depozito `value` olarak gönderilir. İşlem önce simüle edilir; gaz limiti tahminin %10 fazlası olarak açıkça verilir, çünkü Monad ücreti gaz limitine göre alır:

```ts
import {
  chargeMeshEscrowAbi,
  decodeEscrowError,
  quoteToContractArgs,
  type CreateReservationResponse,
} from "@chargemesh/shared";
import { useConnection, useWriteContract } from "@wagmi/vue";
import type { Address, Hex } from "viem";

const connection = useConnection();
const { mutateAsync: writeContractAsync } = useWriteContract();

async function pay({ reservation, quote, signature, contractAddress, chainId }: CreateReservationResponse) {
  const call = {
    account: connection.address.value as Address,
    address: contractAddress as Address,
    abi: chargeMeshEscrowAbi,
    functionName: "reserve",
    args: [quoteToContractArgs(quote), signature as Hex],
    value: BigInt(quote.depositWei),
  } as const;
  try {
    await publicClient.simulateContract(call); // revert edecekse cüzdan hiç açılmaz
    const estimate = await publicClient.estimateContractGas(call);
    const txHash = await writeContractAsync({ ...call, chainId, gas: (estimate * 110n) / 100n });
    await api.confirmReservation(reservation.id, { txHash });
  } catch (err) {
    showError(decodeEscrowError(err)?.message ?? "İşlem tamamlanamadı. Lütfen tekrar deneyin.");
  }
}
```

`reserve()` öncesinde Sürücü'nün bakiyesi `depozito + tahmini ücret + 10 MON` değerinden azsa "Cüzdanınızda en az 10 MON rezerv kalmalı" uyarısı gösterilir (bkz. [Monad'a özgü notlar](#monada-özgü-notlar)).

`decodeEscrowError`, hatanın `cause` zincirini dolaşır; gaz tahmini, simülasyon ya da gönderim sırasında oluşan sözleşme hatalarını tanır. Sözleşme hatası bulamazsa `null` döner; kullanıcının işlemi cüzdanda reddetmesi buna örnektir. Bu durumu ayrıca ele almak isterseniz viem'in `BaseError.walk` yöntemiyle `UserRejectedRequestError` arayabilirsiniz. `InvalidStatus` hatasında mesaj, rezervasyonun şu anki durumunu da içerir: "Rezervasyon bu işlem için uygun durumda değil. Şu anki durumu: iptal edildi."

**"Bekleyen ödemeniz var" uyarısı.** Bağlı cüzdanın `pendingWithdrawal` değeri sıfırdan büyükse uyarı ve çekim düğmesi gösterilir. `withdraw()` de aynı kuralla, simülasyon ve açık gaz limitiyle gönderilir:

```ts
import { chargeMeshEscrowAbi, decodeEscrowError, formatMon } from "@chargemesh/shared";
import { useConnection, useReadContract, useWriteContract } from "@wagmi/vue";
import { computed } from "vue";
import type { Address } from "viem";

const contractAddress = config.contractAddress as Address; // GET /config yanıtından
const connection = useConnection();
const { data: pending, refetch } = useReadContract(
  computed(() => ({
    address: contractAddress,
    abi: chargeMeshEscrowAbi,
    functionName: "pendingWithdrawal",
    args: connection.address.value ? [connection.address.value] : undefined,
    query: { enabled: Boolean(connection.address.value) },
  })),
);
const { mutateAsync: writeContractAsync } = useWriteContract();

async function withdraw() {
  const call = {
    account: connection.address.value as Address,
    address: contractAddress,
    abi: chargeMeshEscrowAbi,
    functionName: "withdraw",
  } as const;
  try {
    await publicClient.simulateContract(call);
    const estimate = await publicClient.estimateContractGas(call);
    await writeContractAsync({ ...call, gas: (estimate * 110n) / 100n });
    await refetch();
  } catch (err) {
    showError(decodeEscrowError(err)?.message ?? "Ödeme çekilemedi. Lütfen tekrar deneyin.");
  }
}

// pending.value !== undefined && pending.value > 0n →
//   "Bekleyen ödemeniz var: {formatMon(pending.value)}" ve [Ödemeyi çek] düğmesi
```

**Explorer bağlantıları.** `explorerTxUrl(chainId, txHash)` Monad testnet'te MonadVision bağlantısı döner. Anvil'de ve mock modda `null` döndüğü için bağlantı gösterilmez; istenirse hash düz metin olarak yazılabilir.

**`chainMode: "mock"`.** `GET /config` yanıtında `chainMode` değeri `"mock"` ise cüzdan açılmaz, `reserve()` ve `withdraw()` gönderilmez, `pendingWithdrawal` da okunmaz. Frontend `0x` + 64 hex karakterlik sahte bir hash üretip doğrudan `confirm` çağırır (bkz. `docs/02-mimari.md`). Bu modda API `chainId` olarak `31337` bildirir; bu yüzden `explorerTxUrl` `null` döner ve "Bekleyen ödemeniz var" uyarısı görünmez.
