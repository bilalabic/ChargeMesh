# @chargemesh/charger-sim

Gerçek bir şarj cihazının yerine geçen, OCPP 1.6J konuşan küçük bir komut satırı uygulaması. Demo sırasında API'ye bağlanır, uzaktan başlatma komutunu alınca şarja başlar, birkaç saniyede bir sayaç değeri gönderir ve durdurulduğunda oturumu kapatır.

Simülatör gerçek bir cihazın diliyle konuşur. Bu sayede ileride gerçek donanıma geçmek, bağlantı adresini değiştirmekten ibaret olur.

## Çalıştırma

API'nin (`:9000`) açık olduğundan emin olun, ardından:

```powershell
corepack pnpm dev:sim
```

Beklenen çıktı:

```
[CM-DEMO-001] connected → BootNotification: Accepted
[CM-DEMO-001] RemoteStartTransaction idTag=CM6F1C2A9B0D4E7F81A2 → Accepted
[CM-DEMO-001] StartTransaction tx=17 meterStart=1000000
[CM-DEMO-001] MeterValues 1000493 Wh · 7400 W · delivered 0.49 kWh
[CM-DEMO-001] StopTransaction tx=17 meterStop=1020000 reason=Remote
```

## Ayarlar

Önce komut satırı bayrağına, sonra ortam değişkenine, en son varsayılan değere bakılır.

| Bayrak | Değişken | Varsayılan | Anlamı |
| --- | --- | --- | --- |
| `--url` | `CS_URL` | `ws://localhost:9000/ocpp` | Merkezi sistem adresi |
| `--id` | `CHARGE_POINT_ID` | `CM-DEMO-001` | Cihaz kimliği (Host'un tanımladığı node ile aynı olmalı) |
| | `CONNECTOR_ID` | `1` | |
| `--power` | `POWER_KW` | `7.4` | Sabit şarj gücü |
| `--scale` | `TIME_SCALE` | `120` | Simülasyon hızı: 1 gerçek saniye, 120 simülasyon saniyesi |
| | `METER_INTERVAL_MS` | `2000` | Sayaç gönderme aralığı |
| | `METER_START_WH` | `1000000` | Sayacın başlangıç değeri |
| `--vehicle-accept` | `VEHICLE_ACCEPT_WH` | sınırsız | Araç bu kadar enerji aldıktan sonra kendiliğinden ayrılır |

Varsayılan ayarlarla 20 kWh yaklaşık 80 saniyede aktarılır.

## Kısmi teslim senaryosu

Aracın talep edilenden az enerji aldığı durumu göstermek için:

```powershell
corepack pnpm --filter @chargemesh/charger-sim dev -- --vehicle-accept 14500
```

Araç tam 14,5 kWh aldıktan sonra `EVDisconnected` nedeniyle ayrılır. Ödeme de bu miktar üzerinden kapanır.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `corepack pnpm --filter @chargemesh/charger-sim typecheck` | Tip kontrolü |
| `corepack pnpm --filter @chargemesh/charger-sim lint` | ESLint |
| `corepack pnpm --filter @chargemesh/charger-sim test` | Enerji hesaplama testleri |

Mesajların tam listesi [docs/05-ocpp.md](../../docs/05-ocpp.md) belgesindedir.
