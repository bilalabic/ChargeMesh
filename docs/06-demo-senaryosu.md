# 06 · Demo Senaryosu

> Sürüm: v1.0 · Sahibi: Entegrasyon sorumlusu
>
> Bu senaryo, ekiplerin ortak **kabul testidir**. Her ekip kendi parçasını bu senaryodaki sayılarla test eder. Entegrasyon aşaması, bu akışın baştan sona kesintisiz çalışmasıyla tamamlanmış sayılır.

## Karakterler

| | Cüzdan | Rol |
| --- | --- | --- |
| **Elif** | Host cüzdanı (testnet) | Moda'daki bir ofis binasının otopark yöneticisi |
| **Can** | Driver cüzdanı (testnet) | Kadıköy'de toplantısı olan bir EV sürücüsü |
| **Settler** | Backend anahtarı | Teklif imzalar, oturumu zincire yazar |

Her üç cüzdanda da [faucet](https://faucet.monad.xyz) üzerinden alınmış testnet MON bulunmalıdır. Can için 0,5 MON, Settler için gas amacıyla 0,5 MON yeterlidir.

## Sabit demo verisi

`POST /demo/seed` bu değerleri oluşturur. Fixture'lar da aynı değerleri kullanır (`shared/src/fixtures`).

| Alan | Değer |
| --- | --- |
| Node | "Moda Ofis Otoparkı", Kadıköy, İstanbul |
| Konum | 40.9869, 29.0267 |
| Bağlantı / güç | `TYPE2`, 7,4 kW |
| Erişim | `GATED_PARKING`: "B2 katı, 14 numaralı park yeri. Bariyerde ChargeMesh rezervasyonunu söyleyin." |
| Charge point | `CM-DEMO-001`, konektör 1 |
| Slot | Şu andan 9 saat sonrasına kadar, en fazla 40 kWh (40.000 Wh) |
| Fiyat | 0,01 MON/kWh (`10000000000000000` wei) |
| Can'ın talebi | Hedef 40.9875, 29.0300 (~0,3 km), varış şimdi, ayrılış +4 saat, **20 kWh** |

## Ana senaryo: tam teslim (yaklaşık 4 dakika)

| # | Ekranda | Arka planda | Beklenen |
| --- | --- | --- | --- |
| 1 | Elif Host panelinde node'unu ve yayınladığı slotu gösterir. Cihaz "Çevrimiçi" görünür. | Simülatör `BootNotification` gönderdi. | Slot `OPEN` |
| 2 | Can Driver ekranında konum, saat ve 20 kWh girer. | `POST /intents`, `GET /matches` | Moda Ofis Otoparkı 1. sırada, "~0,3 km · 20 kWh karşılanabilir · Depozito 0,2 MON" |
| 3 | Can "Rezerve et" der, cüzdan açılır, 0,2 MON onaylanır. | Teklif imzalanır, `reserve()` çağrılır, `confirm` ile doğrulanır. | Rezervasyon `CONFIRMED`, explorer bağlantısı görünür, açık adres ve erişim talimatı açılır. |
| 4 | Can cihazın QR kodunu telefonuyla okutur (ya da demo linkine tıklar), "Şarjı başlat" der. | `RemoteStartTransaction` → `StartTransaction` → `startSession()` | Oturum `CHARGING`, canlı kWh sayacı artar. |
| 5 | Yaklaşık 80 saniye içinde sayaç 20 kWh'e ulaşır. | Backend `RemoteStopTransaction` gönderir → `StopTransaction` → Proof of Charge → `settle()` | Oturum `SETTLED` |
| 6 | Can Proof of Charge ekranını açar. | `GET /reservations/:id/proof` | Talep: 20 kWh, Aktarılan: 20 kWh, Host'a: 0,2 MON, İade: 0 MON. Hash tarayıcıda yeniden hesaplanır ve "Zincirdeki kayıtla eşleşiyor ✓" görünür. |
| 7 | Elif Host panelinde rezervasyonu ve kazancını görür. | | Explorer'da `ReservationSettled` event'i görünür. |

## Yedek senaryo: kısmi teslim

Simülatör `VEHICLE_ACCEPT_WH=14500` ile başlatılır. Araç 14,5 kWh aldıktan sonra kendiliğinden ayrılır (`EVDisconnected`).

| | Değer |
| --- | --- |
| Aktarılan | 14.500 Wh |
| Host'a ödenen | 0,145 MON |
| Can'a iade | 0,055 MON |

Bu senaryo ürünün temel vaadini gösterir: **Ödeme talebe göre değil, gerçekleşen kullanıma göre kapanır.**

## Demo öncesi kontrol listesi

- [ ] `docker compose up -d postgres` çalışıyor, migration'lar uygulandı.
- [ ] Sözleşme testnet'te deploy edildi, doğrulandı ve adresi `deployments.ts` dosyasında.
- [ ] `CHAIN_MODE=monad`, `DEMO_ALLOW_ANY_TIME=true`, settler bakiyesi en az 0,2 MON.
- [ ] API (`:4000`) ve OCPP (`:9000`) ayakta; simülatör bağlı, Host panelinde "Çevrimiçi" görünüyor.
- [ ] Web `NEXT_PUBLIC_API_MODE=live` ile çalışıyor; iki tarayıcı profilinde Elif ve Can cüzdanları bağlı.
- [ ] Demo seed çalıştırıldı ve slot `OPEN` durumunda.
- [ ] Yedek plan: Testnet RPC yavaşlarsa `CHAIN_MODE=anvil` ile yerel zincirde aynı akış.
