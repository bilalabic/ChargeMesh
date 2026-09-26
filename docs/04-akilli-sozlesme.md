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
| `setSettler(address)` | Owner | `address != 0` | `SettlerUpdated` |
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

`settle` çağrısında Host'a ve Driver'a native MON gönderilir (push). Durum değişikliği transferlerden **önce** yapılır (checks-effects-interactions) ve fonksiyon `nonReentrant` korumasına sahiptir. Transfer başarısız olursa işlem revert eder. Hackathon sürümünde, cüzdanların EOA olduğu varsayıldığı için pull-payment modeli kullanılmaz.

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
```

## Hatalar

`NotDriver()`, `NotSettler()`, `InvalidQuote()`, `QuoteExpired()`, `InvalidSignature()`, `IncorrectDeposit()`, `ReservationExists()`, `SlotAlreadyTaken()`, `InvalidStatus(Status current)`, `TooLate()`, `TooEarly()`, `ZeroSessionHash()`, `TransferFailed()`, `ZeroAddress()`.

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
- **EIP-712 uyumu:** `shared` ile üretilen örnek bir imza (sabit anahtar, sabit teklif, `test/fixtures/quote-signature.json`) sözleşme tarafından doğrulanmalıdır. Bu test, TypeScript ile Solidity tanımlarının birbirinden ayrışmasını önler.
- Fuzz: Rastgele `requestedWh`, `deliveredWh` ve `pricePerKwhWei` değerlerinde `hostAmount + refund == deposit` her zaman sağlanmalıdır.

## Deploy ve adres yayını

1. **Yerel:** WSL'de `anvil` çalıştırılır, ardından `forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast` komutuyla deploy yapılır.
2. **Testnet:** `--rpc-url https://testnet-rpc.monad.xyz` kullanılır. Doğrulama komutu: `forge verify-contract <adres> ChargeMeshEscrow --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/`
3. Deploy betiği, adresi ve blok numarasını `contracts/deployments/<chainId>.json` dosyasına yazar (`{ "chainId", "escrow", "settler", "deployBlock" }`).
4. Ardından Windows tarafında `corepack pnpm --filter @chargemesh/shared chain:sync` çalıştırılır. Bu komut `contracts/out/` altındaki ABI'yi `shared/src/chain/abi.ts`, deploy JSON'larını da `shared/src/chain/deployments.ts` dosyasına yazar. Üretilen dosyalar elle düzenlenmez.
5. Adres değişikliği tek başına bir commit olur: `chore(contracts): deploy escrow to monad testnet`.

`DEPLOYER_PRIVATE_KEY` ve `SETTLER_PRIVATE_KEY` yalnızca testnet anahtarlarıdır. Hiçbir koşulda commit edilmez ve mainnet'te kullanılmaz.
