# backend/charger-sim: OCPP Simülatörü Ajan Talimatları

Kök `AGENTS.md` kuralları geçerlidir. Sahibi **Backend** ekibidir. Davranış spesifikasyonu: `docs/05-ocpp.md`.

## Kurallar

- OCPP 1.6J, `ocpp-rpc` `RPCClient`, alt protokol `ocpp1.6`, `strictMode: true`.
- Tek charge point, tek konektör. Durum makinesi: `Available → Preparing → Charging → Finishing → Available`.
- Yapılandırma, `docs/05-ocpp.md` içindeki tabloyla aynıdır: önce CLI bayrağı, sonra env, en son varsayılan.
- Enerji artışı tam sayı Wh olarak hesaplanır. `VEHICLE_ACCEPT_WH` tanımlıysa son örnek bu değere kırpılır.
- Konsol çıktısı, demo ekranında gösterilecek kadar okunabilir olmalıdır (örnek format `docs/05-ocpp.md` içinde).
- Bağlantı koparsa üstel geri çekilmeyle yeniden bağlanır. Aktif işlem varken bağlantı koparsa işlem kaybolmaz; yeniden bağlanınca devam eder.
- Enerji hesaplama mantığı saf fonksiyonlarda tutulur ve Vitest ile test edilir.

## Komutlar

```powershell
corepack pnpm --filter @chargemesh/charger-sim dev                     # varsayılanlarla
corepack pnpm --filter @chargemesh/charger-sim dev -- --vehicle-accept 14500
corepack pnpm --filter @chargemesh/charger-sim typecheck
corepack pnpm --filter @chargemesh/charger-sim test
```
