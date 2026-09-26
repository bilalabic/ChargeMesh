# 04 · Akıllı Sözleşme: `ChargeMeshEscrow`

> Sürüm: v1.0 · Sahibi: Blockchain ekibi
>
> **Tek doğruluk kaynağı** `contracts/src/interfaces/IChargeMeshEscrow.sol` dosyasıdır. Frontend ve backend'in kullandığı ABI bu arayüzden üretilir ve `shared/src/chain/abi.ts` dosyasına yazılır. Arayüz değişirse ABI yeniden üretilmeden commit yapılmaz.

## Amaç

Sözleşmenin üç görevi vardır:

1. Backend'in (settler) imzaladığı bir teklifle **rezervasyonu ve depozitoyu** zincire kilitlemek
2. Oturum bittiğinde **aktarılan enerjiye göre** depozitoyu Host ile Driver arasında paylaştırmak
3. Oturum özetinin **hash'ini** (Proof of Charge) kalıcı olarak kaydetmek

Konum, adres, erişim bilgisi, kişi veya araç bilgisi ve ham sayaç verisi sözleşmeye **girmez**.

## Güven modeli

- **Settler**, backend'in tuttuğu tek bir EOA'dır. Hem teklifleri imzalar hem de `startSession` ve `settle` çağrılarını yapar.
- Driver, settler'ın imzaladığı bir teklif olmadan rezervasyon açamaz. Bu sayede fiyat, Host adresi, enerji miktarı ve zaman penceresi backend'in onayladığı değerlerle sınırlı kalır.
- Oturum sonucunu settler bildirir. Bu bir **güven varsayımıdır**: Sözleşme, sayaç verisinin doğruluğunu kanıtlayamaz; yalnızca beyan edilen sonucu ve bu sonucun hash'ini kayda geçirir. Settler'ın kötüye kullanım alanı sınırlıdır: En fazla `depositWei` kadar tutarı Host'a yönlendirebilir.
- Backend çökerse sürücünün parası kilitli kalmaz. `expire()` çağrısı herkese açıktır ve süre dolduğunda depozitoyu iade eder.
- Hiçbir taraf diğerinin ödemesini engelleyemez. Alıcı ödemeyi reddederse tutar kaybolmaz, `pendingWithdrawal` hanesine yazılır ve sahibi bunu `withdraw()` ile çeker (bkz. [Ödeme modeli](#ödeme-modeli)).
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
| `reserve(ReservationQuote q, bytes sig) payable` | Driver | `msg.sender == q.driver` · `msg.value == q.depositWei` · `block.timestamp <= q.quoteExpiry` · `q.startTime < q.endTime` · `q.requestedWh > 0` · `q.depositWei == ceilDiv(q.requestedWh × q.pricePerKwhWei, 1000)` · imzalayan == `settler` · rezervasyon `None` · `slotRef` boşta | `Reserved`, `slotTaken[slotRef] = true`, `ReservationCreated` |
| `startSession(bytes32 id)` | Settler | Durum `Reserved` · `block.timestamp <= endTime` | `Active`, `SessionStarted` |
| `settle(bytes32 id, uint32 deliveredWh, bytes32 sessionHash)` | Settler | Durum `Active` · `sessionHash != 0` | `Settled`, Host'a `hostAmount`, Driver'a `refund` gönderilir, `ReservationSettled` |
| `cancel(bytes32 id)` | Driver | Durum `Reserved` · `block.timestamp < startTime` | `Cancelled`, depozitonun tamamı iade edilir, slot serbest kalır, `ReservationCancelled` |
| `expire(bytes32 id)` | Herkes | (`Reserved` ve `block.timestamp > endTime`) **veya** (`Active` ve `block.timestamp > endTime + SETTLEMENT_GRACE`) | `Expired`, depozitonun tamamı Driver'a iade edilir, slot serbest kalır, `ReservationExpired` |
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

Gönderim 100.000 gaz sınırıyla ve dönüş verisi kopyalanmadan yapılır. Alıcı ödemeyi reddederse (kodlu bir cüzdan, EIP-7702 ile yetkilendirilmiş bir EOA veya kasıtlı olarak revert eden bir sözleşme) işlem **geri alınmaz**. Tutar alıcının `pendingWithdrawal` hanesine yazılır, `PaymentDeferred` olayı yayılır ve alıcı parasını daha sonra `withdraw()` ile çeker.

Ertelemenin yalnızca alıcının kendi hatasından kaynaklanması gerekir, çağıranın değil. EVM'de bir alt çağrıya kalan gazın en fazla 63/64'ü iletilebilir. Bu yüzden herkese açık `expire` bilerek düşük gazla çağrılırsa, kodlu bir alıcıya yapılan ödeme yapay olarak başarısız kılınabilirdi. Bunu önlemek için sözleşme, tam gaz payını iletecek kadar gaz kalmamışsa ödemeyi ertelemek yerine işlemi `InsufficientGas` ile geri alır.

Bu model neden gerekli? Salt push modelinde, iadeyi reddeden bir sürücü `settle` çağrısını tamamen engelleyebilir, ardından `SETTLEMENT_GRACE` sonunda `expire` ile depozitonun tamamını geri alabilirdi. Yani şarj bedava olurdu. Yuvarlama nedeniyle iade çoğu zaman en az 1 wei olduğundan bu saldırı gerçekçidir. "Gönder, olmazsa alacak yaz" modeli bu yolu kapatır: Host'un ödemesi, sürücünün cüzdanı ne yaparsa yapsın gerçekleşir.

Frontend ve backend, `pendingWithdrawal(adres) > 0` olduğunda kullanıcıya "Bekleyen ödemeniz var" uyarısı ve `withdraw()` düğmesi gösterir.

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
| `cancel` | durum `Reserved` değil: `InvalidStatus(current)` → çağıran driver değil: `NotDriver` → `block.timestamp >= startTime`: `TooLate` |
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
- `startSession` ve `settle`: tam teslim, kısmi teslim (`delivered < requested`), fazla teslim (`delivered > requested`) ve `delivered = 0` durumları. Bakiyeler kuruşu kuruşuna doğrulanır.
- `cancel` ve `expire` için zaman sınırları (`vm.warp`)
- Reentrancy: Host adresi kötü niyetli bir sözleşme olduğunda `settle` yeniden giriş yapamaz.
- Ödeme reddi: Ödemeyi reddeden, sonsuz döngüye giren veya yeniden girmeye çalışan bir Host ya da Driver, diğer tarafın ödemesini engelleyemez. Tutar `pendingWithdrawal` hanesine yazılır ve `withdraw()` ile çekilebilir.
- Gaz koruması: `expire` gibi herkese açık bir çağrı bilerek düşük gazla yapılırsa, ödeme ertelemeye zorlanmaz; işlem `InsufficientGas` ile geri alınır.
- `withdraw`: `NothingToWithdraw`, başarılı çekim, çift çekim denemesi.
- **EIP-712 uyumu:** `shared` ile üretilen örnek bir imza (sabit anahtar, sabit teklif, `test/fixtures/quote-signature.json`) sözleşme tarafından doğrulanmalıdır. Bu test, TypeScript ile Solidity tanımlarının birbirinden ayrışmasını önler.
- Fuzz: Rastgele `requestedWh`, `deliveredWh` ve `pricePerKwhWei` değerlerinde `hostAmount + refund == deposit` her zaman sağlanmalıdır. Ödemesi ertelenen alıcılar olduğunda da sözleşme bakiyesi, açık depozitolar ile bekleyen alacakların toplamına eşit kalmalıdır.

## Deploy ve adres yayını

1. **Yerel:** WSL'de `anvil` çalıştırılır, ardından `forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast` komutuyla deploy yapılır.
2. **Testnet:** `--rpc-url https://testnet-rpc.monad.xyz` kullanılır. Deploy betiği adresi simülasyon aşamasında yazar. Bu yüzden `chain:sync` öncesinde `cast code <adres> --rpc-url …` ile adreste gerçekten kod olduğu doğrulanmalıdır. Doğrulama komutu: `forge verify-contract <adres> ChargeMeshEscrow --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/`
3. Deploy betiği, adresi ve blok numarasını `contracts/deployments/<chainId>.json` dosyasına yazar (`{ "chainId", "escrow", "settler", "deployBlock" }`).
4. Ardından Windows tarafında `corepack pnpm --filter @chargemesh/shared chain:sync` çalıştırılır. Bu komut `contracts/out/` altındaki ABI'yi `shared/src/chain/abi.ts`, deploy JSON'larını da `shared/src/chain/deployments.ts` dosyasına yazar. Üretilen dosyalar elle düzenlenmez.
5. Adres değişikliği tek başına bir commit olur: `chore(contracts): deploy escrow to monad testnet`.

`DEPLOYER_PRIVATE_KEY` ve `SETTLER_PRIVATE_KEY` yalnızca testnet anahtarlarıdır. Hiçbir koşulda commit edilmez ve mainnet'te kullanılmaz.

## Entegrasyon rehberi

Bu bölüm, frontend ve backend'in sözleşmeyle nasıl konuşacağını kısa örneklerle anlatır. Kullanılan yardımcıların hepsi `@chargemesh/shared` paketindedir (`shared/src/chain/`). ABI'yi, adresleri, hata çözümlemeyi ve durum dönüşümünü kendi tarafınızda yeniden yazmayın.

**Adres kuralı:** Sözleşme adresi ve deploy bloğu her zaman `getDeployment(chainId)` ile alınır. Testnet için bu çağrı `getDeployment(10143)`, yani `getDeployment(monadTestnet.id)` olur. Adres hiçbir yere elle yazılmaz; yeni bir deploy sonrasında `chain:sync` çalıştırmak yeterlidir.

| Yardımcı | Ne işe yarar |
| --- | --- |
| `buildQuoteTypedData`, `quoteToContractArgs` | Teklifi EIP-712 imzası ve `reserve()` argümanı için hazırlar |
| `findReservationCreated(receipt, reservationId, escrow)` | Receipt içinde, escrow adresinden yayılmış `ReservationCreated` olayını bulur; bulamazsa `null` döner |
| `parseEscrowEvents(logs, { escrow? })` | Loglardaki escrow olaylarını tipli olarak çözer |
| `getEscrowEventsForReservation(client, { escrow, reservationId, fromBlock?, toBlock? })` | Bir rezervasyonun tüm olaylarını eskiden yeniye getirir; `fromBlock` verilmezse `deployBlock` kullanılır |
| `OnchainStatus`, `onchainStatusName`, `onchainStatusToReservationStatus` | Zincirdeki `Status` değerini adına ve API'deki `ReservationStatus` karşılığına çevirir |
| `decodeEscrowError(err)`, `ESCROW_ERROR_MESSAGES_TR` | viem/wagmi hatalarının içinden sözleşme hatasını çıkarır ve kullanıcıya gösterilecek Türkçe mesajı verir |
| `explorerTxUrl(chainId, hash)` | Monad testnet'te explorer bağlantısı üretir; diğer zincirlerde `null` döner |

`ESCROW_ERROR_MESSAGES_TR`, ABI'deki hata adlarına göre tip kontrolünden geçer. ABI'ye yeni bir hata eklenip mesajı yazılmazsa `shared` paketinin `typecheck` adımı kırılır.

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

**`confirm` doğrulaması.** Receipt başarılı olmalı, `to` alanı escrow adresini göstermeli ve loglarda bu rezervasyona ait bir `ReservationCreated` bulunmalıdır. `findReservationCreated`, başka bir sözleşmenin yaydığı aynı imzalı olayları ve başarısız receipt'leri kendisi eler:

```ts
import { findReservationCreated } from "@chargemesh/shared";
import { isAddressEqual, type Hex } from "viem";

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 30_000 });
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
```

İşlem henüz bloğa girmediyse `getTransactionReceipt` bir `TransactionReceiptNotFoundError` fırlatır. Bu yüzden kısa bir zaman aşımıyla `waitForTransactionReceipt` kullanmak daha sağlamdır. `confirm` idempotent olduğu için istemci aynı hash'le tekrar çağırabilir.

**`startSession` ve `settle`.** İşlemi göndermeden önce `simulateContract` ile denemek, olası bir revert'ü gaz harcamadan ve okunabilir bir hatayla yakalamayı sağlar:

```ts
import { chargeMeshEscrowAbi } from "@chargemesh/shared";

const { request } = await publicClient.simulateContract({
  account: settlerAccount,
  address: deployment.escrow,
  abi: chargeMeshEscrowAbi,
  functionName: "settle", // startSession için: functionName: "startSession", args: [onchainId]
  args: [onchainId, deliveredWh, sessionHash],
});
const hash = await settlerWallet.writeContract(request);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
```

**`settle` başarısız olursa.** Rezervasyon `FAILED` durumuna geçer ve işlem yeniden denenebilir (bkz. `docs/02-mimari.md`). Tekrar denemeden önce zincirdeki durumu okuyun; önceki işlem aslında başarıyla bloğa girmiş olabilir:

- `getReservation` durumu `Settled` gösteriyorsa (ya da `decodeEscrowError` bir `InvalidStatus` döndürdüyse ve durum `Settled` ise) işlemi yeniden göndermeyin. `getEscrowEventsForReservation` ile `ReservationSettled` olayını bulun, tx hash'ini ve tutarları oradan alın, rezervasyonu `SETTLED` yapın.
- Durum `Expired` ise `SETTLEMENT_GRACE` dolmuş ve biri `expire()` çağırmıştır. Rezervasyon `EXPIRED` olur, yeniden deneme yapılmaz.
- Durum hâlâ `Active` ise aynı `deliveredWh` ve `sessionHash` ile tekrar gönderin. Bu değerler deterministik olduğu için tekrar denemek güvenlidir. Ağ, nonce veya gaz kaynaklı hatalarda artan beklemeyle (backoff) birkaç deneme yeterlidir.
- `NotSettler`, settler anahtarının değiştiğini; `ZeroSessionHash` ise backend'de bir hata olduğunu gösterir. Bu iki durumda otomatik deneme yapılmaz, hata loglanır.
- Settler tek bir EOA olduğu için işlemleri sırayla gönderin. Aynı anda gönderilen iki işlem nonce çakışmasına yol açar.

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

**Bekleyen ödemeler.** Ödemeyi reddeden alıcının tutarı `pendingWithdrawal` hanesine yazılır (bkz. [Ödeme modeli](#ödeme-modeli)). `settle` receipt'inde `PaymentDeferred` olayı olup olmadığına bakabilir, bakiyeyi de doğrudan okuyabilirsiniz:

```ts
import { chargeMeshEscrowAbi, parseEscrowEvents } from "@chargemesh/shared";

const deferred = parseEscrowEvents(receipt.logs, { escrow: deployment.escrow }).filter(
  (e) => e.eventName === "PaymentDeferred",
);
const pending = await publicClient.readContract({
  address: deployment.escrow,
  abi: chargeMeshEscrowAbi,
  functionName: "pendingWithdrawal",
  args: [account],
}); // wei, bigint
```

`getEscrowEventsForReservation`, `fromBlock` verilmediğinde taramaya `deployBlock` değerinden başlar. Herkese açık RPC'ler `eth_getLogs` için blok aralığını sınırlayabilir. Böyle bir durumda aralığı `fromBlock` ve `toBlock` ile daraltın. Güncel durumu öğrenmek için olay taraması yerine `getReservation` okumayı tercih edin.

### Frontend

**Rezervasyon (`reserve`).** Adres ve zincir bilgisi `POST /reservations` yanıtındaki `contractAddress` ve `chainId` alanlarından gelir; backend bu değerleri `getDeployment` ile doldurur. Depozito `value` olarak gönderilir:

```tsx
import {
  chargeMeshEscrowAbi,
  decodeEscrowError,
  quoteToContractArgs,
  type CreateReservationResponse,
} from "@chargemesh/shared";
import type { Address, Hex } from "viem";
import { useWriteContract } from "wagmi";

const { mutateAsync: writeContract } = useWriteContract();

async function pay({ reservation, quote, signature, contractAddress, chainId }: CreateReservationResponse) {
  try {
    const txHash = await writeContract({
      address: contractAddress as Address,
      abi: chargeMeshEscrowAbi,
      functionName: "reserve",
      args: [quoteToContractArgs(quote), signature as Hex],
      value: BigInt(quote.depositWei),
      chainId,
    });
    await api.confirmReservation(reservation.id, { txHash });
  } catch (err) {
    showError(decodeEscrowError(err)?.message ?? "İşlem tamamlanamadı. Lütfen tekrar deneyin.");
  }
}
```

`decodeEscrowError`, hatanın `cause` zincirini dolaşır; gaz tahmini, simülasyon ya da gönderim sırasında oluşan sözleşme hatalarını tanır. Sözleşme hatası bulamazsa `null` döner; kullanıcının işlemi cüzdanda reddetmesi buna örnektir. Bu durumu ayrıca ele almak isterseniz viem'in `BaseError.walk` yöntemiyle `UserRejectedRequestError` arayabilirsiniz. `InvalidStatus` hatasında mesaj, rezervasyonun şu anki durumunu da içerir: "Rezervasyon bu işlem için uygun durumda değil. Şu anki durumu: iptal edildi."

**"Bekleyen ödemeniz var" uyarısı.** Bağlı cüzdanın `pendingWithdrawal` değeri sıfırdan büyükse uyarı ve çekim düğmesi gösterilir:

```tsx
import { chargeMeshEscrowAbi, decodeEscrowError, formatMon } from "@chargemesh/shared";
import type { Address } from "viem";
import { useConnection, useReadContract, useWriteContract } from "wagmi";

const contractAddress = config.contractAddress as Address; // GET /config yanıtından
const { address } = useConnection();
const { data: pending, refetch } = useReadContract({
  address: contractAddress,
  abi: chargeMeshEscrowAbi,
  functionName: "pendingWithdrawal",
  args: address ? [address] : undefined,
  query: { enabled: Boolean(address) },
});
const { mutateAsync: writeContract } = useWriteContract();

async function withdraw() {
  try {
    await writeContract({ address: contractAddress, abi: chargeMeshEscrowAbi, functionName: "withdraw" });
    await refetch();
  } catch (err) {
    showError(decodeEscrowError(err)?.message ?? "Ödeme çekilemedi. Lütfen tekrar deneyin.");
  }
}

// pending !== undefined && pending > 0n →
//   "Bekleyen ödemeniz var: {formatMon(pending)}" ve [Ödemeyi çek] düğmesi
```

**Explorer bağlantıları.** `explorerTxUrl(chainId, txHash)` Monad testnet'te MonadVision bağlantısı döner. Anvil'de ve mock modda `null` döndüğü için bağlantı gösterilmez; istenirse hash düz metin olarak yazılabilir.

**`chainMode: "mock"`.** `GET /config` yanıtında `chainMode` değeri `"mock"` ise cüzdan açılmaz, `reserve()` ve `withdraw()` gönderilmez, `pendingWithdrawal` da okunmaz. Frontend `0x` + 64 hex karakterlik sahte bir hash üretip doğrudan `confirm` çağırır (bkz. `docs/02-mimari.md`). Bu modda API `chainId` olarak `31337` bildirir; bu yüzden `explorerTxUrl` `null` döner ve "Bekleyen ödemeniz var" uyarısı görünmez.
