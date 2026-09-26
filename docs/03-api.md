# 03 · REST API Sözleşmesi (v1)

> Sürüm: v1.1 · Sahibi: Backend (değişiklik protokolü için bkz. [07-paralel-calisma.md](07-paralel-calisma.md#sözleşme-değişikliği-protokolü))
>
> **Tek doğruluk kaynağı** `shared/src/api/` altındaki zod şemalarıdır. Bu belge o şemaları insanlar için anlatır. İkisi çelişirse şema geçerlidir ve belge düzeltilir.

## Genel kurallar

- Temel adres: `http://localhost:4000/api/v1`. İstisnalar: `GET /health` kökte bulunur.
- Gövde ve yanıtlar `application/json` biçimindedir. Alan adları `camelCase` yazılır.
- **Zaman:** Alanlar ISO 8601 UTC (`2026-10-03T10:00:00.000Z`). İstemciler zamanı `Date.prototype.toISOString()` ile gönderir; `Z` yerine saat farkı (`+03:00`) içeren değerler reddedilir. Yalnızca zincire giden teklif alanları (`startTime`, `endTime`, `quoteExpiry`) Unix saniyesidir ve ISO değerden `Math.floor(ms / 1000)` ile türetilir.
- **Enerji:** Her zaman tam sayı **Wh**. kWh yalnızca arayüzde gösterim içindir (`whToKwh`).
- **Para:** Her zaman wei cinsinden, **ondalık tam sayı string** (`"10000000000000000"`). JavaScript `number` kullanılmaz; hesaplamalar `bigint` ile yapılır.
- **Adresler:** `0x` ile başlayan 40 hex karakter. API adresleri küçük harfe çevirerek saklar ve döndürür.
- **Kimlikler:** Uygulama kimlikleri UUID'dir. Zincir kimlikleri `bytes32` hex'tir (bkz. [Kimlik dönüşümleri](#kimlik-dönüşümleri)).
- İsteğe bağlı alanlar yoksa `null` döner, alan silinmez.
- Liste uçlarında sayfalama yoktur; sonuçların tamamı tek yanıtta döner.

## Kimlik

Hackathon sürümünde oturum veya imza doğrulaması **yoktur**. İstemci, bağlı cüzdan adresini her istekte başlıkla gönderir:

```
x-wallet-address: 0xAbC...123
```

- Kimlik gerektiren uçlar başlık yoksa `401 UNAUTHORIZED` döner.
- Sahiplik gerektiren uçlar (başkasının node'u, başkasının rezervasyonu) `403 FORBIDDEN` döner.
- `EventSource` başlık gönderemediği için SSE ucu adresi `?wallet=0x...` sorgu parametresiyle alır.

> Bu yöntem kimlik taklidine açıktır ve yalnızca demo içindir. Gerçek sürümde SIWE (EIP-4361) kullanılmalıdır.

## Hata biçimi

```json
{ "error": { "code": "SLOT_UNAVAILABLE", "message": "Slot is already held or reserved.", "details": null } }
```

| HTTP | `code` | Ne zaman |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Gövde, parametre veya sorgu şemaya uymuyor (`details` alanında zod hataları bulunur). |
| 401 | `UNAUTHORIZED` | `x-wallet-address` yok veya geçersiz. |
| 403 | `FORBIDDEN` | Kaynak bu cüzdana ait değil. |
| 404 | `NOT_FOUND` | Kaynak yok. |
| 409 | `SLOT_UNAVAILABLE` | Slot `OPEN` değil veya teklif verilirken başkası tuttu. |
| 409 | `INVALID_STATE` | İşlem mevcut durumda yapılamaz (ör. `CONFIRMED` olmayan rezervasyonda oturum başlatmak, hesaplaşmadan önce Proof istemek). |
| 409 | `CHARGER_OFFLINE` | İlgili charge point OCPP'ye bağlı değil. |
| 409 | `OUTSIDE_TIME_WINDOW` | Oturum rezervasyon penceresi dışında başlatılmak isteniyor. |
| 409 | `AMBIGUOUS_RESERVATION` | `reservationId` verilmedi ve bu noktada Sürücü'nün birden çok uygun rezervasyonu var. |
| 422 | `CHAIN_VERIFICATION_FAILED` | Tx bulunamadı, başarısız oldu ya da beklenen event'i içermiyor. |
| 500 | `INTERNAL` | Beklenmeyen hata. |

## Kimlik dönüşümleri

`shared/src/ids.ts` içinde tanımlıdır. Tüm bileşenler bu fonksiyonları kullanır, kendi versiyonunu yazmaz.

| Fonksiyon | Tanım | Örnek kullanım |
| --- | --- | --- |
| `toOnchainReservationId(uuid)` | `keccak256(utf8("reservation:" + uuid))` | Sözleşmedeki `reservationId` |
| `toSlotRef(uuid)` | `keccak256(utf8("slot:" + uuid))` | Sözleşmedeki `slotRef` |
| `toOcppIdTag(uuid)` | `"CM" + uuid'den tireler çıkarılmış ilk 18 karakter`, büyük harf (toplam 20) | OCPP `idTag` (en fazla 20 karakter) |

## Veri modelleri

Tüm modeller `shared/src/api/schemas.ts` içindedir. Kısa özet:

### Enum'lar

| Tip | Değerler |
| --- | --- |
| `ConnectorType` | `TYPE2`, `TYPE1` |
| `AccessType` | `OPEN_PARKING`, `GATED_PARKING`, `BUILDING_GARAGE` |
| `SlotStatus` | `OPEN`, `HELD`, `RESERVED`, `CLOSED` |
| `ReservationStatus` | `PENDING_PAYMENT`, `HOLD_EXPIRED`, `CONFIRMED`, `ACTIVE`, `COMPLETED`, `SETTLED`, `CANCELLED`, `EXPIRED`, `FAILED` |
| `SessionStatus` | `STARTING`, `CHARGING`, `STOPPING`, `COMPLETED`, `SETTLING`, `SETTLED`, `FAILED` |
| `ChainMode` | `mock`, `anvil`, `monad` |

### `ChargingNode`

Herkese açık görünüm (`PublicChargingNode`):

```json
{
  "id": "6f1c...uuid",
  "hostAddress": "0x...",
  "name": "Moda Ofis Otoparkı",
  "areaLabel": "Kadıköy, İstanbul",
  "connectorType": "TYPE2",
  "maxPowerKw": 7.4,
  "accessType": "GATED_PARKING",
  "ocppChargePointId": "CM-DEMO-001",
  "ocppConnectorId": 1,
  "online": true,
  "createdAt": "2026-10-03T08:00:00.000Z"
}
```

Tam görünüm (`ChargingNode`) yalnızca node'un sahibine döner ve ek olarak şu alanları içerir: `addressLine`, `lat`, `lng`, `accessInstructions`, `startUrl`. `startUrl`, cihazın üzerine yapıştırılacak QR kodun içeriğidir: `${WEB_BASE_URL}/start?cp={ocppChargePointId}&c={ocppConnectorId}`.

### `EnergySlot`

```json
{
  "id": "uuid",
  "nodeId": "uuid",
  "slotRef": "0x…32 byte",
  "startsAt": "2026-10-03T06:00:00.000Z",
  "endsAt": "2026-10-03T15:00:00.000Z",
  "maxEnergyWh": 40000,
  "pricePerKwhWei": "10000000000000000",
  "status": "OPEN",
  "createdAt": "…"
}
```

### `ChargeIntent`

```json
{
  "id": "uuid",
  "driverAddress": "0x...",
  "lat": 40.9869, "lng": 29.0267, "radiusKm": 3,
  "arriveAt": "2026-10-03T07:00:00.000Z",
  "departAt": "2026-10-03T11:00:00.000Z",
  "requestedWh": 20000,
  "connectorType": "TYPE2",
  "acceptedAccessTypes": ["OPEN_PARKING", "GATED_PARKING", "BUILDING_GARAGE"],
  "createdAt": "…"
}
```

### `MatchResult`

```json
{
  "rank": 1,
  "slotId": "uuid",
  "node": { "…": "PublicChargingNode" },
  "distanceKm": 0.4,
  "window": { "startsAt": "…", "endsAt": "…" },
  "deliverableWh": 29600,
  "fullyCovers": true,
  "quotedWh": 20000,
  "pricePerKwhWei": "10000000000000000",
  "estimatedCostWei": "200000000000000000",
  "depositWei": "200000000000000000"
}
```

- `deliverableWh`: Bu slotun pencere boyunca verebileceği en fazla enerji.
- `quotedWh`: Teklife girecek enerji, yani `min(requestedWh, deliverableWh)`. Arayüzdeki "20 kWh karşılanabilir" ifadesi `quotedWh` değerini gösterir; depozito ve tahmini ücret de bu değerden hesaplanır.

### `Reservation`

```json
{
  "id": "uuid",
  "onchainId": "0x…32 byte",
  "intentId": "uuid",
  "slotId": "uuid",
  "driverAddress": "0x...",
  "hostAddress": "0x...",
  "status": "CONFIRMED",
  "requestedWh": 20000,
  "pricePerKwhWei": "10000000000000000",
  "depositWei": "200000000000000000",
  "window": { "startsAt": "…", "endsAt": "…" },
  "holdExpiresAt": "…",
  "node": { "…": "PublicChargingNode" },
  "access": {
    "addressLine": "Caferağa Mah. …",
    "lat": 40.9869, "lng": 29.0267,
    "accessInstructions": "B2 katı, 14 numaralı park yeri. Bariyerde rezervasyon kodunu söyleyin."
  },
  "sessionId": null,
  "txs": { "reserve": "0x…", "start": null, "settle": null, "cancel": null },
  "settlement": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

- `access` alanı yalnızca **Sürücü'ye** ve yalnızca durum `CONFIRMED`, `ACTIVE`, `COMPLETED` veya `SETTLED` iken doludur. Diğer durumlarda `null` döner.
- `settlement`: `{ deliveredWh, billableWh, hostAmountWei, refundWei, sessionHash }`, yalnızca `SETTLED` durumunda doludur.
- `holdExpiresAt`: Slotun bu rezervasyon için tutulduğu son an, `quoteExpiry + 60 sn` (bkz. [`POST /reservations` davranışı](#post-reservations-davranışı)).
- Bekleyen ödeme (`pendingWithdrawal`) API'de yer almaz. Frontend bu değeri doğrudan zincirden okur; backend yalnızca `PaymentDeferred` olaylarını loglar.

### `ReservationQuote`

Sözleşmeye gönderilecek teklifin JSON karşılığıdır. `bigint` alanlar string'dir. Frontend, `quoteToContractArgs(quote)` yardımcısıyla bunu `reserve()` argümanlarına çevirir.

```json
{
  "reservationId": "0x…", "slotRef": "0x…",
  "driver": "0x…", "host": "0x…",
  "requestedWh": 20000,
  "pricePerKwhWei": "10000000000000000",
  "depositWei": "200000000000000000",
  "startTime": 1791010800, "endTime": 1791025200,
  "quoteExpiry": 1791003300
}
```

### `ChargingSession`

```json
{
  "id": "uuid",
  "reservationId": "uuid",
  "status": "CHARGING",
  "chargePointId": "CM-DEMO-001",
  "connectorId": 1,
  "ocppTransactionId": 17,
  "requestedWh": 20000,
  "meterStartWh": 1000000,
  "latestMeterWh": 1008420,
  "deliveredWh": 8420,
  "powerW": 7400,
  "startedAt": "…", "stoppedAt": null, "stopReason": null,
  "sessionHash": null,
  "txs": { "start": "0x…", "settle": null },
  "updatedAt": "…"
}
```

## Uç noktalar

Aşağıdaki tabloda 🔑 kimlik ister, 👤 kaynağın sahibi olmayı ister.

### Sistem

| Metot ve yol | Açıklama | Yanıt |
| --- | --- | --- |
| `GET /health` | Canlılık kontrolü | `{ status: "ok", chainMode, chainId }` |
| `GET /config` | Frontend'in ihtiyaç duyduğu zincir bilgileri. `live` modda frontend `chainId`, `contractAddress` ve `explorerUrl` değerlerini yalnızca buradan alır. `CHAIN_MODE=mock` iken `chainId` `31337`'dir. | `AppConfig`: `{ chainId, chainMode, contractAddress, settlerAddress, explorerUrl, quoteTtlSeconds }` |
| `GET /chargers` | OCPP bağlantı durumu (hata ayıklama ve Host paneli için) | `ChargerStatus[]`: `{ chargePointId, connected, lastSeenAt, connectorStatus }` |
| `POST /demo/seed` 🔑 | **Yalnızca** `NODE_ENV !== "production"`. Aşağıya bakın. | `{ node: ChargingNode, slot: EnergySlot }` |

`POST /demo/seed` davranışı charge point kimliği `CM-DEMO-001` üzerinden belirlenir:

- Bu kimlikte node yoksa çağıran cüzdan adına oluşturulur. Node başka bir cüzdana aitse `409 INVALID_STATE` döner.
- Node'da `OPEN` durumda bir slot yoksa şu anı kapsayan **yeni** bir `OPEN` slot oluşturulur. Hesaplaşması biten slotlar zincirde dolu kaldığı için tekrar kullanılmaz. `OPEN` bir slot varsa o slot döner.
- Aynı çağrıyı tekrarlamak güvenlidir; yalnızca eksik olan oluşturulur.

### Host

| Metot ve yol | Gövde | Yanıt |
| --- | --- | --- |
| `POST /nodes` 🔑 | `CreateNodeRequest` | `201 ChargingNode` |
| `GET /nodes?mine=true` 🔑 | – | `ChargingNode[]` (yalnızca kendi node'ları, tam görünüm) |
| `GET /nodes` | – | `PublicChargingNode[]` (tüm node'ların herkese açık görünümü) |
| `GET /nodes/:nodeId` | – | Sahibine `ChargingNode`, diğerlerine `PublicChargingNode` |
| `POST /nodes/:nodeId/slots` 🔑👤 | `CreateSlotRequest` | `201 EnergySlot` |
| `GET /nodes/:nodeId/slots` | – | `EnergySlot[]` (başlangıç zamanına göre artan) |
| `POST /slots/:slotId/close` 🔑👤 | – | `EnergySlot` (yalnızca `OPEN` iken, aksi halde `INVALID_STATE`) |
| `GET /nodes/:nodeId/reservations` 🔑👤 | – | `Reservation[]` (`access` alanı Host'a `null` döner) |

`CreateNodeRequest` doğrulama kuralları:

| Alan | Kural |
| --- | --- |
| `name` | 3–80 karakter |
| `areaLabel` | 2–60 karakter, ör. "Kadıköy, İstanbul" |
| `addressLine` | 5–200 karakter (özel) |
| `lat`, `lng` | Geçerli koordinat (özel) |
| `connectorType` | `ConnectorType` |
| `maxPowerKw` | 1–22 (AC) |
| `accessType` | `AccessType` |
| `accessInstructions` | 0–500 karakter (özel) |
| `ocppChargePointId` | `^[A-Za-z0-9._-]{3,48}$`, sistem genelinde benzersiz |
| `ocppConnectorId` | ≥ 1, varsayılan 1 |

`CreateSlotRequest`: süre (`endsAt − startsAt`) 30 dakika ile 24 saat arasında, `endsAt` gelecekte, `maxEnergyWh` 1.000–200.000 Wh, `pricePerKwhWei` sıfırdan büyük. Bu kurallar, geçmiş tarih kontrolü dahil shared şemasında tanımlıdır ve ihlal edilirse `400 VALIDATION_ERROR` döner. Aynı node'da `CLOSED` olmayan slotlarla zaman çakışması `409 INVALID_STATE` döndürür.

### Sürücü

| Metot ve yol | Gövde | Yanıt |
| --- | --- | --- |
| `POST /intents` 🔑 | `CreateIntentRequest` | `201 ChargeIntent` |
| `GET /intents/:intentId` 🔑👤 | – | `ChargeIntent` |
| `GET /intents/:intentId/matches` 🔑👤 | – | `{ intentId, generatedAt, matches: MatchResult[] }` (en fazla 10) |
| `POST /reservations` 🔑 | `{ intentId, slotId }` | `201 { reservation, quote, signature, contractAddress, chainId }`. Aynı teklif tekrar istenirse `200` ile mevcut kayıt döner. |
| `POST /reservations/:id/confirm` 🔑👤 | `{ txHash }` | `Reservation` (idempotent) |
| `POST /reservations/:id/sync` 🔑👤 | `{ txHash?: string }` | `Reservation`. Zincirdeki güncel durumu okur; `cancel` ve `expire` sonrası kullanılır. |
| `GET /reservations?role=driver\|host` 🔑 | – | `Reservation[]` (yeniden eskiye) |
| `GET /reservations/:id` 🔑👤 | – | `Reservation` (Sürücü veya Host görebilir) |
| `GET /reservations/:id/proof` 🔑👤 | – | `ProofResponse`. Rezervasyon `COMPLETED` olmadan önce `409 INVALID_STATE` döner. |

`CreateIntentRequest`: `departAt` gelecekte, süre (`departAt − arriveAt`) en az 15 dakika ve en fazla 24 saat, `requestedWh` 1.000–100.000, `radiusKm` 0,5–25 (varsayılan 3), `acceptedAccessTypes` boş olamaz (varsayılan: hepsi). Bu kurallar da shared şemasındadır; ihlal `400 VALIDATION_ERROR` döndürür.

#### `POST /reservations` davranışı

1. Aynı Sürücü aynı intent ve slot için daha önce teklif aldıysa ve tutma süresi dolmadıysa yeni kayıt açılmaz; mevcut rezervasyon, teklif ve imza `200` ile döner. Böylece istemci isteği güvenle tekrarlayabilir.
2. Slot `OPEN` değilse (veya başka bir rezervasyon adına `HELD` olup süresi dolmamışsa) `409 SLOT_UNAVAILABLE` döner.
3. Eşleşme bu intent için yeniden hesaplanır. Slot artık uygun değilse yine `409 SLOT_UNAVAILABLE` döner.
4. Rezervasyon `PENDING_PAYMENT`, slot `HELD` olur. Slot, kendisini tutan rezervasyonun kimliğini saklar; sonraki her slot geçişi bu kimliğe göre filtrelenir. Böylece bir rezervasyonun senkronizasyonu, başka bir rezervasyonun tuttuğu slotu açamaz.
5. Süreler: `quoteExpiry = now + QUOTE_TTL_SECONDS` ve `holdExpiresAt = quoteExpiry + 60 sn`. Aradaki 60 saniye, son anda gönderilen işlemin bloğa girmesi ve saat farkları içindir. Süre dolumu tembel değerlendirilir: ayrı bir zamanlayıcı yoktur, kayıt okunurken veya güncellenirken kontrol edilir.
6. Teklif alanları şöyle doldurulur: `requestedWh = quotedWh`, `startTime`/`endTime` = eşleşme penceresi, `depositWei = depositFor(quotedWh, pricePerKwhWei)`. Teklif, settler anahtarıyla EIP-712 olarak imzalanır.

#### `POST /reservations/:id/confirm` davranışı

- Tx receipt'i alınır. `status === success`, `to === contractAddress` olmalı ve loglarda bu `onchainId` ile bir `ReservationCreated` bulunmalıdır. Olaydaki değerler saklanan teklifle aynı olmalıdır.
- Backend, receipt'in bloğu kesinleşene kadar bekler (`waitForFinalized`, bkz. [02-mimari.md](02-mimari.md#monadda-dikkat-edilecekler)). Bu genellikle yaklaşık 1 saniye ekler; yanıt birkaç saniye sürebilir. Zaman aşımında istemci aynı hash'le isteği tekrarlar.
- Koşullar sağlanırsa rezervasyon `CONFIRMED`, slot `RESERVED` olur.
- Durum `HOLD_EXPIRED` ise de `confirm` kabul edilir: `reserve()` `quoteExpiry`'den önce bloğa girmiş, onay ise geç gelmiş olabilir. Doğruluk kaynağı zincirdir. Olay doğrulanırsa slot bu rezervasyona `RESERVED` olarak atanır. Slot bu arada başka bir rezervasyon adına `HELD` olduysa o rezervasyon `HOLD_EXPIRED` yapılır; zincir aynı `slotRef` için ikinci `reserve()` çağrısını zaten `SlotAlreadyTaken` ile reddeder.
- Zaten `CONFIRMED` olan bir rezervasyon için aynı hash tekrar gönderilirse mevcut kayıt döner. Farklı bir hash gönderilirse `409 INVALID_STATE` döner.
- `CHAIN_MODE=mock` iken biçimi doğru her hash kabul edilir.

#### Frontend'in zincirde doğrudan yaptıkları

- **Bekleyen ödemeler:** Frontend, bağlı cüzdanın `pendingWithdrawal` değerini doğrudan sözleşmeden okur; sıfırdan büyükse uyarı ve `withdraw()` düğmesi gösterir. API'de bu bilgi için alan yoktur.
- **Depozitoyu geri alma (`expire`):** "Depozitoyu geri al" düğmesi `CONFIRMED` rezervasyonlarda `window.endsAt` geçtikten sonra, `ACTIVE`, `COMPLETED` ve `FAILED` rezervasyonlarda ise `window.endsAt + 1 gün` (`SETTLEMENT_GRACE`) geçtikten sonra görünür. İşlem onaylanınca `POST /reservations/:id/sync` çağrılır.
- **İptal (`cancel`):** Sürücü başlangıçtan önce zincirde `cancel()` çağırır, ardından `sync` çağrılır.

### Oturum

| Metot ve yol | Gövde | Yanıt |
| --- | --- | --- |
| `POST /sessions/start` 🔑 | `{ chargePointId, connectorId, reservationId?: uuid }` | `201 ChargingSession` (`STARTING`). Oturum zaten varsa `200` ile mevcut oturum döner. |
| `GET /sessions/:id` 🔑👤 | – | `ChargingSession` |
| `POST /sessions/:id/stop` 🔑👤 | – | `ChargingSession` (`STOPPING`) |
| `GET /sessions/:id/events?wallet=0x…` 🔑👤 | – | `text/event-stream` |

`POST /sessions/start` kontrolleri:

- Rezervasyon Sürücü'ye aittir ve `CONFIRMED` durumundadır. `reservationId` verilmezse Sürücü'nün o noktadaki tek `CONFIRMED` rezervasyonu seçilir; hiç yoksa `404 NOT_FOUND`, birden fazlaysa `409 AMBIGUOUS_RESERVATION` döner.
- Node'un `ocppChargePointId`/`ocppConnectorId` değerleri istekle eşleşir ve cihaz bağlıdır.
- `DEMO_ALLOW_ANY_TIME=false` ise `now ∈ [startsAt − 15 dk, endsAt]` olmalıdır.
- Rezervasyonun `STARTING`, `CHARGING` veya `STOPPING` durumunda bir oturumu varsa yeni oturum açılmaz, mevcut oturum döner. Önceki oturum `FAILED` ile bittiyse yeni oturum açılabilir.
- Zincirde `Active` görünüp API'de `CONFIRMED` kalan bir rezervasyon (ör. `startSession` ile veritabanı yazımı arasında çökme) `sync` ile `ACTIVE` yapılır; bu durumda `start` `409 INVALID_STATE` döner. Depozito `SETTLEMENT_GRACE` sonrasında `expire()` ile geri alınır.

Başlatma akışı:

1. Backend `RemoteStartTransaction` gönderir. Simülatör `StartTransaction` ile yanıt verir ve Central System bu mesaja **hemen** `Accepted` döner.
2. `startSession()` işlemi asenkron gönderilir ve hata alırsa yeniden denenir. Oturum, `txs.start` kesinleşene kadar `STARTING` kalır; bu sırada gelen sayaç değerleri yine kaydedilir. İşlem kesinleşince oturum `CHARGING`, rezervasyon `ACTIVE` olur.
3. `startSession()` sonunda da başarısız olursa backend `RemoteStopTransaction` gönderir, oturum `FAILED` olur, rezervasyon `CONFIRMED` kalır ve hesaplaşma yapılmaz.
4. `STARTING` durumundayken `stop` çağrılırsa backend başlatmayı `RemoteStopTransaction` ile iptal eder. `startSession()` henüz gönderilmediyse gönderilmez ve oturum `FAILED` olur. İşlem zaten gönderildiyse sonucu beklenir; başarılıysa oturum normal durdurma ve hesaplaşma yolundan devam eder.

Oturum şu durumlarda biter:

- Sürücü `stop` çağırır.
- `deliveredWh ≥ requestedWh` olur. Backend bu durumda `RemoteStopTransaction` gönderir.
- Simülatör kendiliğinden `StopTransaction` gönderir (araç ayrıldı).

`deliveredWh`, sayaç adımları nedeniyle `requestedWh` değerini biraz aşabilir; ödemede ise hiçbir zaman aşmaz, çünkü sözleşme `billableWh = min(deliveredWh, requestedWh)` hesaplar.

#### SSE olayları

| `event` | `data` |
| --- | --- |
| `session.updated` | `ChargingSession` |
| `meter` | `{ sessionId, timestamp, energyWh, deliveredWh, powerW }` |
| `settled` | `{ sessionId, reservationId, settlement }` |
| `session.error` | `{ code, message }` |

- Yalnızca rezervasyonun Sürücü'sü veya Host'u abone olabilir. Adres `?wallet=` ile verilir; yoksa veya geçersizse `401`, başka bir cüzdansa `403` döner.
- Bağlantı açılınca sunucu önce güncel `session.updated` olayını, oturum zaten `SETTLED` ise ardından `settled` olayını gönderir. İstemci `settled` olayını aldıktan sonra bağlantıyı kapatır.
- Her 15 saniyede bir `: ping` yorumu yollanır.
- SSE yanıtı Fastify'ın yanıt hattını atlayıp doğrudan yazıldığı için CORS başlıkları (`Access-Control-Allow-Origin: WEB_BASE_URL`) bu yanıta ayrıca eklenir.

### Proof of Charge

`GET /reservations/:id/proof` yanıtı (`ProofResponse`):

```json
{
  "summary": { "…": "ProofOfChargeSummary" },
  "canonicalJson": "{\"chainId\":10143,…}",
  "sessionHash": "0x…",
  "onchain": {
    "sessionHash": "0x…", "deliveredWh": 20000, "billableWh": 20000,
    "hostAmountWei": "200000000000000000", "refundWei": "0", "txHash": "0x…"
  },
  "verified": true
}
```

- Proof, rezervasyon `COMPLETED` olduktan sonra alınabilir; daha önce `409 INVALID_STATE` döner.
- `onchain`, rezervasyon `SETTLED` olana kadar `null` döner; bu durumda `verified` da `false` olur.
- `verified`, `keccak256(canonicalJson) === onchain.sessionHash` sonucudur. Frontend bu hesabı `computeSessionHash` ile tarayıcıda tekrar yapar ve sonucu kullanıcıya gösterir.

`ProofOfChargeSummary` (sürüm `chargemesh.poc.v1`):

| Alan | Tip | Açıklama |
| --- | --- | --- |
| `version` | `"chargemesh.poc.v1"` | |
| `chainId` | int | |
| `contract` | adres | |
| `reservationId` | bytes32 | `onchainId` |
| `chargePointId` | string | |
| `connectorId` | int | |
| `ocppTransactionId` | int | |
| `startedAt`, `stoppedAt` | ISO | |
| `meterStartWh`, `meterStopWh` | int | |
| `requestedWh`, `deliveredWh` | int | `deliveredWh = meterStopWh − meterStartWh` |
| `stopReason` | string | OCPP `Reason` değeri (`Remote`, `EVDisconnected`, `Local`, …) |
| `meterSamples` | `{ count, samplesHash }` | Ham örnekler zincire yazılmaz; yalnızca örnek dizisinin kanonik JSON hash'i özete girer. |
| `source` | `"ocpp-simulator"` | Gerçek donanım değil |

**Kanonik JSON kuralları** (`canonicalize()` fonksiyonu): Nesne anahtarları her seviyede sözlük sırasına dizilir. Boşluk kullanılmaz. Yalnızca string, tam sayı, boolean, `null`, dizi ve nesne kullanılabilir; ondalıklı sayı ve `undefined` hata verir. Hash, `keccak256(utf8(canonicalJson))` ile hesaplanır. Özette kişisel veri ve açık adres **bulunmaz**.

## Eşleştirme algoritması

`shared/src/matching.ts` içinde saf fonksiyon olarak tanımlıdır (`rankMatches`). Backend bu fonksiyonu çağırır; frontend ise mock modunda aynı fonksiyonu fixture'larla kullanır.

Her aday slot için (`status = OPEN` veya süresi dolmuş `HELD`):

1. **Bağlantı:** `node.connectorType === intent.connectorType` olmalıdır.
2. **Erişim:** `node.accessType ∈ intent.acceptedAccessTypes` olmalıdır.
3. **Mesafe:** Haversine mesafesi `≤ intent.radiusKm` olmalıdır.
4. **Pencere:** `window = [max(slot.startsAt, intent.arriveAt), min(slot.endsAt, intent.departAt)]`. Süre en az 15 dakika olmalıdır.
5. **Karşılanabilir enerji:** `deliverableWh = floor(min(slot.maxEnergyWh, node.maxPowerKw × 1000 × pencereSaat))`. Değer 0 veya daha küçükse aday elenir.
6. `fullyCovers = deliverableWh ≥ intent.requestedWh` ve `quotedWh = min(intent.requestedWh, deliverableWh)`.

Sıralama sırasıyla şu anahtarlara göre yapılır:

1. `fullyCovers` (önce `true` olanlar)
2. `distanceKm` artan (tam hassasiyetle; ekranda 0,1 km'ye yuvarlanır)
3. `pricePerKwhWei` artan
4. `deliverableWh` azalan
5. `slotId` sözlük sırası (son eşitlik bozucu)

İlk 10 sonuç `rank` 1'den başlanarak numaralandırılır.

## Birim ve ücret hesapları

`shared/src/units.ts` dosyası, sözleşmeyle **bire bir aynı** tam sayı aritmetiğini kullanır:

| Fonksiyon | Tanım |
| --- | --- |
| `depositFor(wh, pricePerKwhWei)` | `ceil(wh × price / 1000)` |
| `computeSettlement({ requestedWh, deliveredWh, pricePerKwhWei, depositWei })` | `billableWh = min(delivered, requested)`, `hostAmount = min(floor(billableWh × price / 1000), deposit)`, `refund = deposit − hostAmount` |
| `whToKwh(wh)` | Gösterim içindir, `number` döner |
| `formatMon(wei)` | Gösterim içindir; ör. `"0.2 MON"` |
