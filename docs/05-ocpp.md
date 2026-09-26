# 05 · OCPP Entegrasyonu ve Simülatör

> Sürüm: v1.1 · Sahibi: Backend ekibi (`backend/api` içindeki Central System ve `backend/charger-sim`)

## Neden OCPP?

OCPP (Open Charge Point Protocol), şarj cihazlarının merkezi sistemle konuşmak için kullandığı açık standarttır. Hackathon'da gerçek cihaz kullanmıyoruz. Yine de simülatörü gerçek bir cihazın konuştuğu dilde konuşturuyoruz, böylece ileride gerçek donanıma geçiş yalnızca bağlantı adresini değiştirmekten ibaret olur.

Sürüm olarak **OCPP 1.6J** (WebSocket üzerinden JSON) kullanıyoruz. En yaygın desteklenen sürüm budur.

## Bağlantı

| Alan | Değer |
| --- | --- |
| Adres | `ws://localhost:9000/ocpp/{chargePointId}` |
| WebSocket alt protokolü | `ocpp1.6` |
| Kimlik doğrulama | Yok (demo). `BootNotification` her zaman `Accepted` ile yanıtlanır. `chargePointId` kayıtlı bir node'un `ocppChargePointId` değeriyle eşleşmiyorsa cihaz bağlı kalır ama bu noktada oturum başlatılamaz. |
| Kütüphane | Her iki uçta da [`ocpp-rpc`](https://www.npmjs.com/package/ocpp-rpc) (`RPCServer` / `RPCClient`), `strictMode: true` |

## Mesajlar

### Cihazdan merkeze (Charge Point → Central System)

| Mesaj | Ne zaman | Central System yanıtı |
| --- | --- | --- |
| `BootNotification` | Bağlantı açılınca | Her zaman `{ status: "Accepted", currentTime, interval: 30 }` |
| `Heartbeat` | Her `interval` saniyede | `{ currentTime }` |
| `StatusNotification` | Konektör durumu değişince (`Available`, `Preparing`, `Charging`, `Finishing`) | `{}` |
| `StartTransaction` | `RemoteStartTransaction` kabul edildikten sonra | `{ transactionId, idTagInfo: { status: "Accepted" } }`. `idTag` bilinmiyorsa `Invalid` döner. |
| `MeterValues` | Şarj sırasında her `METER_INTERVAL_MS`'de | `{}` |
| `StopTransaction` | Durdurma isteği geldiğinde veya araç ayrıldığında | `{ idTagInfo: { status: "Accepted" } }` |

`MeterValues` örneği:

```json
{
  "connectorId": 1,
  "transactionId": 17,
  "meterValue": [{
    "timestamp": "2026-10-03T07:12:00.000Z",
    "sampledValue": [
      { "value": "1008420", "measurand": "Energy.Active.Import.Register", "unit": "Wh", "context": "Sample.Periodic" },
      { "value": "7400", "measurand": "Power.Active.Import", "unit": "W", "context": "Sample.Periodic" }
    ]
  }]
}
```

### Merkezden cihaza (Central System → Charge Point)

| Mesaj | Gövde | Simülatör davranışı |
| --- | --- | --- |
| `RemoteStartTransaction` | `{ connectorId, idTag }` | Konektör `Available` ise `Accepted` döner, `Preparing` durumuna geçer, ardından `StartTransaction` gönderir ve şarjı başlatır. Aksi halde `Rejected`. |
| `RemoteStopTransaction` | `{ transactionId }` | Aktif işlem eşleşirse `Accepted` döner ve `StopTransaction` gönderir (`reason: "Remote"`). |

## Backend tarafındaki eşlemeler

- Bir charge point'in `online` sayılması için WebSocket bağlantısının açık olması ve `BootNotification` mesajının kabul edilmiş olması gerekir (`online = soket bağlı && boot kabul edildi`).
- `idTag = toOcppIdTag(reservation.id)` (20 karakter). `StartTransaction` içindeki `idTag` bu değerle rezervasyona bağlanır.
- `StartTransaction` hemen yanıtlanır; `startSession()` işlemi zincire ayrıca ve asenkron gönderilir (bkz. [03-api.md](03-api.md#oturum)). İşlem sonunda başarısız olursa backend `RemoteStopTransaction` gönderir.
- `transactionId`, backend'in ürettiği artan bir tam sayıdır ve oturum belgesinin `ocppTransactionId` alanında saklanır.
- Gelen her `MeterValues` mesajı `meterSamples` koleksiyonunda ham haliyle saklanır. `deliveredWh = son Energy.Active.Import.Register − meterStart` olarak hesaplanır.
- `deliveredWh ≥ requestedWh` olduğunda backend `RemoteStopTransaction` gönderir.
- `StopTransaction` geldiğinde: `deliveredWh = meterStop − meterStart` → Proof of Charge özeti → `settle()`.
- Tüm ham OCPP çağrıları (yön, eylem, gövde, zaman) hata ayıklama için `ocppMessages` koleksiyonunda tutulur.

## Simülatör (`backend/charger-sim`)

Tek bir charge point'i ve tek bir konektörü taklit eden bir CLI uygulamasıdır.

### Yapılandırma

| Değişken / bayrak | Varsayılan | Anlamı |
| --- | --- | --- |
| `CS_URL` / `--url` | `ws://localhost:9000/ocpp` | `chargePointId` sona eklenir |
| `CHARGE_POINT_ID` / `--id` | `CM-DEMO-001` | |
| `CONNECTOR_ID` | `1` | |
| `POWER_KW` / `--power` | `7.4` | Sabit şarj gücü |
| `TIME_SCALE` / `--scale` | `120` | Simülasyon hızı. 120 değeri, 1 gerçek saniyede 2 dakikalık şarj anlamına gelir. |
| `METER_INTERVAL_MS` | `2000` | Gerçek zamanlı örnekleme aralığı |
| `METER_START_WH` | `1000000` | Sayaç başlangıç değeri |
| `VEHICLE_ACCEPT_WH` / `--vehicle-accept` | *(sınırsız)* | Doluysa araç bu kadar enerji aldıktan sonra kendiliğinden ayrılır (`reason: "EVDisconnected"`). Kısmi teslim senaryosu için kullanılır. |

Her örnekte eklenen enerji şöyle hesaplanır: `POWER_KW × 1000 × (METER_INTERVAL_MS / 1000) × TIME_SCALE / 3600` Wh (tam sayıya yuvarlanır). Örneğin 7,4 kW, 2 sn ve 120× ile her örnekte 493 Wh eklenir. 20 kWh'lik talep 41. örnekte, yani yaklaşık 80 saniyede karşılanır. Sayaç adımlarla ilerlediği için tam teslimde ölçülen enerji talebi biraz aşar (41 × 493 = 20.213 Wh, yaklaşık 20,2 kWh); ödeme ise talep edilen enerjiyle sınırlıdır (`billableWh = min(deliveredWh, requestedWh)`). `VEHICLE_ACCEPT_WH` tanımlıysa son örnek bu değere kırpılır; böylece kısmi teslim senaryosunda aktarılan enerji tam olarak bu değer olur.

### Konsol çıktısı

Simülatör her olayı tek satırda ve okunabilir biçimde yazar. Bu çıktı demo sırasında ekranda gösterilebilir:

```
[CM-DEMO-001] connected → BootNotification: Accepted
[CM-DEMO-001] RemoteStartTransaction idTag=CM6F1C2A9B0D4E7F81A2 → Accepted
[CM-DEMO-001] StartTransaction tx=17 meterStart=1000000
[CM-DEMO-001] MeterValues 1000493 Wh · 7400 W · delivered 0.49 kWh
…
[CM-DEMO-001] StopTransaction tx=17 meterStop=1020213 reason=Remote
```
