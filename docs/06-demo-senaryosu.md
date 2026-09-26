# 06 · Demo Senaryosu

> Sürüm: v1.1 · Sahibi: Entegrasyon sorumlusu
>
> Bu senaryo, ekiplerin ortak **kabul testidir**. Her ekip kendi parçasını bu senaryodaki sayılarla test eder. Entegrasyon aşaması, bu akışın baştan sona kesintisiz çalışmasıyla tamamlanmış sayılır. Belge, sunumu yapacak kişinin adım adım uygulayabileceği şekilde yazılmıştır.

## Karakterler

| | Cüzdan | Rol |
| --- | --- | --- |
| **Elif** | Host cüzdanı (testnet) | Moda'daki bir ofis binasının otopark yöneticisi |
| **Can** | Sürücü cüzdanı (testnet) | Kadıköy'de toplantısı olan bir elektrikli araç sürücüsü |
| **Settler** | Backend anahtarı (`0x10562C789bB833c1930cdc7115D4fC0C4D32BA73`) | Teklif imzalar, oturumu zincire yazar |

## Sahne düzeni: tek dizüstü bilgisayar

Demo tek bir dizüstü bilgisayarda yapılır, telefon kullanılmaz.

- Chrome'da iki ayrı profil açılır: **Elif** ve **Can**. Her profilde ayrı bir MetaMask kurulur ve yalnızca o kişinin cüzdanı içe aktarılır. Böylece iki cüzdan birbirine karışmaz.
- QR kodu Elif'in Host ekranında görsel olarak durur ve seyirciye gösterilir. Can, kendi profilindeki rezervasyon ekranında **"Şarjı başlat"** düğmesine basar. QR okutma adımı canlandırılmaz.

Her iki MetaMask'a Monad testnet şu değerlerle eklenir (**Settings > Networks > Add a network > Add a network manually**):

| Alan | Değer |
| --- | --- |
| Network name | Monad Testnet |
| New RPC URL | `https://testnet-rpc.monad.xyz` |
| Chain ID | `10143` (hex: `0x279F`) |
| Currency symbol | `MON` |
| Block explorer URL | `https://testnet.monadvision.com` |

## Bakiyeler ve anahtarlar

Monad'da her hesabın bakiyesinde 10 MON'luk bir **reserve balance** tamponu bulunmalıdır; bakiyeyi bu sınırın altına düşüren işlemler revert edebilir (bkz. [04-akilli-sozlesme.md](04-akilli-sozlesme.md#monada-özgü-notlar)). Ücret de harcanan gaza göre değil, gaz limitine göre alınır.

| Cüzdan | Gereken bakiye | Neden |
| --- | --- | --- |
| Elif (Host) | 0 MON | Elif hiç işlem göndermez; ödeme ona gelir. Reserve kuralı onu etkilemez. |
| Can (Sürücü) | **En az 12 MON** | 10 MON reserve + her provada 0,2 MON depozito + gaz ücreti |
| Settler | **En az 11 MON** | 10 MON reserve + `startSession` ve `settle` gaz ücretleri |

- Faucet ([faucet.monad.xyz](https://faucet.monad.xyz)) güvenilir değildir. Can ve settler ekip cüzdanından doldurulur. Her provadan sonra Can'ın bakiyesi yeniden 12 MON'un üstüne çıkarılır.
- Cüzdana MON gönderildikten sonra ilk `reserve()` işleminden önce 1–2 saniye beklenir.
- **Settler anahtarı**, testnet deploy anahtarıdır ve entegrasyon sorumlusunda durur. Demo bilgisayarına yalnızca elle, `backend/api/.env` dosyasındaki `SETTLER_PRIVATE_KEY` değişkeni olarak girilir. Git'e, sohbet kanallarına veya ekran paylaşımına girmez. Backend açılışta bu anahtarın adresini zincirdeki `settler()` değeriyle karşılaştırır; eşleşmezse çalışmaz.

## Sabit prova verisi

Bu değerler Host arayüzündeki **Yeni node** ve **Yeni slot yayınla** formlarından MongoDB Atlas'a kaydedilir. Normal canlı akışta frontend mock'u ve `/demo/seed` yardımcısı kullanılmaz.

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

## Hazırlık: başlatma sırası

Komutlar depo kökünde, PowerShell'de çalıştırılır. `backend/api/.env` içinde `CHAIN_MODE=monad`, `DEMO_ALLOW_ANY_TIME=false`, `MONGODB_URI` ve `SETTLER_PRIVATE_KEY` dolu olmalıdır. `frontend/.env.local` içinde `VITE_API_MODE=live`, `VITE_API_URL=http://localhost:4000/api/v1` ve `VITE_CHAIN_ID=10143` bulunur.

1. **Canlı sistemi başlatın:** `.\scripts\dev.ps1`. Betik Atlas indekslerini doğrular; API'yi Monad modunda, simülatörü ve frontend'i canlı API modunda açar; ardından ön kontrolü çalıştırır.
2. **Cüzdanları bağlayın:** Elif ve Can profillerinde MetaMask bağlantısını açın, Monad testnet'i seçin. Uygulama yanlış ağdaysa ağ ekleme/değiştirme isteği gösterir.
3. **Node'u Atlas'a kaydedin:** Elif Host panelinde **Yeni node** ile yukarıdaki sabit prova değerlerini girsin. `CHARGE_POINT_ID=CM-DEMO-001` değeriyle simülatör kaydı birebir eşleşmelidir.
4. **Slot'u Atlas'a kaydedin:** Node ayrıntısında şu andan en az 30 dakika sonra başlayan, dört saatlik, 40 kWh ve 0,01 MON/kWh değerli yeni bir slot yayınlayın. Slot `OPEN`, cihaz "Çevrimiçi" görünmelidir.
5. **Ön kontrolü gerektiğinde tekrarlayın:** `.\scripts\preflight.ps1 -DriverAddress <CAN_PUBLIC_ADRESİ>` (bkz. [Demo öncesi kontrol listesi](#demo-öncesi-kontrol-listesi)). Bu kontrol salt okunurdur.

**Önceden açılacak explorer sekmeleri** (Can'ın profilinde):

- Escrow sözleşmesi: `https://testnet.monadvision.com/address/{{ESCROW_ADDRESS}}`
- Elif'in adresi: `https://testnet.monadvision.com/address/<ELİF_ADRESİ>` (ödemenin geldiğini göstermek için)
- Can'ın adresi: `https://testnet.monadvision.com/address/<CAN_ADRESİ>`

## Ana senaryo: tam teslim (yaklaşık 4 dakika)

| # | Ekranda | Arka planda | Beklenen |
| --- | --- | --- | --- |
| 1 | Elif Host panelinde node'unu ve yayınladığı slotu gösterir. Cihaz "Çevrimiçi" görünür. | Simülatör `BootNotification` gönderdi. | Slot `OPEN` |
| 2 | Can Sürücü ekranında konum, saat ve 20 kWh girer. | `POST /intents`, `GET /matches` | Moda Ofis Otoparkı 1. sırada, "~0,3 km · 20 kWh karşılanabilir · Depozito 0,2 MON" |
| 3 | Can "Rezerve et" der, MetaMask açılır, 0,2 MON onaylanır. | Teklif imzalanır, işlem simüle edilir, `reserve()` açık gaz limitiyle gönderilir, `confirm` işlemin kesinleşmesini bekleyip doğrular. | Rezervasyon `CONFIRMED`, explorer bağlantısı görünür, açık adres ve erişim talimatı açılır. |
| 4 | Elif'in ekranındaki QR kodu gösterilir. Can kendi profilinde "Şarjı başlat" düğmesine basar. | `RemoteStartTransaction` → `StartTransaction` → `startSession()` | Oturum `CHARGING`, canlı kWh sayacı artar. |
| 5 | Yaklaşık 80 saniye içinde sayaç 20 kWh'i geçer. | Backend `RemoteStopTransaction` gönderir → `StopTransaction` → Proof of Charge → `settle()` | Oturum `SETTLED` |
| 6 | Can Proof of Charge ekranını açar. | `GET /reservations/:id/proof` | Talep: 20 kWh · Aktarılan: ≈ 20,2 kWh · Faturalanan: 20 kWh · Host'a: 0,2 MON · İade: 0 MON. Hash tarayıcıda yeniden hesaplanır ve "Zincirdeki kayıtla eşleşiyor ✓" görünür. |
| 7 | Elif Host panelinde rezervasyonu ve kazancını görür. | | Explorer'da `ReservationSettled` olayı ve Elif'in adresine gelen 0,2 MON görünür. |

**Neden ≈ 20,2 kWh?** Simülatör sayacı 2 saniyede bir yaklaşık 493 Wh artırır. Backend durdurma komutunu sayaç 20 kWh'i geçtiğinde gönderir; bu yüzden son örnek 20.000 Wh'in biraz üstüne çıkar (41 × 493 = 20.213 Wh). Sözleşme `billableWh = min(deliveredWh, requestedWh)` hesapladığı için faturalanan miktar 20 kWh'te kalır. Sunumda bu fark, "ödeme talep edilen miktarı aşmaz" mesajı için kullanılabilir.

## Yedek senaryo: kısmi teslim

Simülatör araç sınırıyla yeniden başlatılır (önce [Prova sıfırlama](#prova-sıfırlama) adımlarıyla yeni bir slot açın):

```powershell
corepack pnpm dev:sim -- --vehicle-accept 14500
```

Araç 14,5 kWh aldıktan sonra kendiliğinden ayrılır (`EVDisconnected`).

| | Değer |
| --- | --- |
| Aktarılan | 14.500 Wh |
| Host'a ödenen | 0,145 MON |
| Can'a iade | 0,055 MON |

Bu senaryo ürünün temel vaadini gösterir: **Ödeme talebe göre değil, gerçekleşen kullanıma göre kapanır.**

## İptal senaryosu (isteğe bağlı)

`cancel` yalnızca rezervasyon penceresi başlamadan çalışır (`block.timestamp < startTime`). Ana senaryodaki "varış şimdi" değeriyle yapılan bir rezervasyon iptal edilemez. İptali göstermek için Can talebi girerken varış saatini **şu andan 30 dakika sonrası** olarak seçer. Rezervasyon onaylandıktan sonra "İptal et" ile depozitonun tamamı geri döner ve slot yeniden `OPEN` olur.

## Prova sıfırlama

Tamamlanan (`settle` edilmiş) bir slot zincirde dolu kalır ve yeniden rezerve edilemez. Her provadan sonra:

1. **Yeni slot açın:** Elif'in Host ekranında aynı node için gelecekte başlayan yeni bir slot yayınlayın. Tamamlanmış slot yeniden kullanılamaz.
2. **Simülatörü yeniden başlatın:** Simülatör penceresinde `Ctrl+C`, ardından `corepack pnpm dev:sim`.
3. **Can'ın bakiyesini tamamlayın:** Ekip cüzdanından Can'a MON gönderin; bakiye 12 MON'un üstünde olmalıdır. Settler bakiyesinin 11 MON'un üstünde olduğunu da kontrol edin.
4. **Veritabanını temizlemeyin:** Normal canlı akışta geçmiş kayıtlar Atlas'ta kalır. Ayrı bir kontrollü prova veritabanı gerekirse yeni bir `MONGODB_DB_NAME` seçin, indeks komutunu çalıştırın ve node/slot kayıtlarını arayüzden yeniden oluşturun. Mevcut veritabanını silmeyin.


## Hata tatbikatları

Provada şu durumları en az bir kez deneyin:

- **Simülatör bağlantısı koptu:** Host panelinde cihaz "Çevrimdışı" görünür. Simülatör penceresinde `Ctrl+C` ile durdurup `corepack pnpm dev:sim` ile yeniden başlatın; simülatör kendiliğinden yeniden bağlanır ve cihaz "Çevrimiçi" olur.
- **`settle` başarısız oldu (`FAILED`):** Oturum ekranında hata mesajı görünür (SSE `session.error` olayı). Önce `POST /reservations/:id/sync` ile zincirdeki durumu okuyun; önceki işlem aslında bloğa girmiş olabilir. Durum hâlâ `Active` ise backend'in sunduğu yeniden deneme yolunu kullanın (yönetici uç noktası veya otomatik deneme; bkz. [08-acik-isler.md](08-acik-isler.md)).
- **RPC yavaş veya yanıt vermiyor:** MetaMask uzun süre bekliyor ya da API zincir hatası veriyorsa [Yedek plan](#yedek-plan-rpc-değiştirmek-veya-anvil) bölümüne geçin.

## Yedek plan: RPC değiştirmek veya Anvil

### Önce hafif çözüm: başka bir RPC

`backend/api/.env` içinde `RPC_URL=https://rpc-testnet.monadinfra.com` yazın ve API'yi yeniden başlatın. Gerekirse iki MetaMask'ta da Monad Testnet ağının RPC adresini aynı şekilde değiştirin (**Settings > Networks > Monad Testnet**). Sözleşme, cüzdanlar ve veritabanı aynı kalır.

### Son çare: yerel zincir (Anvil)

Testnet tamamen kullanılamıyorsa aynı akış yerel bir Anvil zincirinde oynatılır. Anvil'de explorer yoktur; explorer bağlantıları gizlenir ve Monad'a özgü reserve kuralı geçerli değildir. Adımlar:

1. **Anvil'i başlatın.** Ayrı bir PowerShell penceresinde çalıştırın ve demo boyunca **kapatmayın**; pencere kapanırsa zincir sıfırlanır:

   ```powershell
   wsl.exe -d Ubuntu-24.04 -- bash -lc "~/.foundry/bin/anvil"
   ```

   Windows'tan `http://localhost:8545` adresine ulaşılamıyorsa `anvil --host 0.0.0.0` ile başlatın.
2. **Sözleşmeyi deploy edin.** Anvil'in 0 numaralı hesabının anahtarı komut satırında açıkça verilir; aksi halde `forge`, `contracts/.env` dosyasındaki testnet anahtarını yükler ve bu anahtarın Anvil'de bakiyesi yoktur:

   ```powershell
   wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 SETTLER_ADDRESS= ~/.foundry/bin/forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast"
   ```

3. **ABI'yi ve yerel adresi paylaşılan pakete alın.** `forge build` sonrasında yerel deploy'u da dahil ederek eşitleyin (bu çıktı commit edilmez):

   ```powershell
   wsl.exe -d Ubuntu-24.04 -- bash -lc "cd /mnt/c/Users/bilal/projects/ChargeMesh/contracts && ~/.foundry/bin/forge build"
   corepack pnpm --filter @chargemesh/shared chain:sync --include-local
   ```

4. **Backend'i Anvil'e çevirin.** `backend/api/.env` içinde `CHAIN_MODE=anvil`, `SETTLER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Anvil #0) ve `RPC_URL=` (boş) yazın. Testnet settler anahtarını bu dosyadan silmeden önce güvenli bir yere not edin.
5. **Frontend'i Anvil'e çevirin.** `frontend/.env.local` içinde `VITE_CHAIN_ID=31337` yazın ve `corepack pnpm dev:frontend` sürecini yeniden başlatın; Vite ortam değişkenlerini yalnızca açılışta okur.
6. **MetaMask'ı hazırlayın.** İki profilde de bir "Anvil" ağı ekleyin: RPC `http://localhost:8545`, Chain ID `31337`, sembol `ETH`. Elif profiline Anvil #1 (`0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`), Can profiline Anvil #2 (`0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a8d4ab8b0d0a`) anahtarını içe aktarın. Bu anahtarlar herkesçe bilinen Anvil test anahtarlarıdır; yalnızca yerel zincirde kullanılır. Anvil her yeniden başlatıldığında iki profilde de **Settings > Advanced > Clear activity tab data** ile nonce geçmişini sıfırlayın.
7. **Ayrı veritabanıyla başlayın.** `MONGODB_DB_NAME` değerini yeni bir adla değiştirin (ör. `chargemesh_anvil`), `corepack pnpm --filter @chargemesh/api db:indexes` çalıştırın ve API'yi yeniden başlatın. Elif'in Anvil adresiyle (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`) bağlanıp node ile slotu arayüzden oluşturun.

## Demo öncesi kontrol listesi

- [ ] Bilgisayarın saati eşitlendi (**Settings > Time & language > Date & time > Sync now**). Teklifin geçerlilik süresi (`quoteExpiry`) bu saatle hesaplanır; saat kaymışsa `reserve()` `QuoteExpired` ile reddedilir.
- [ ] İnternet bağlantısı var ve bu bilgisayarın IP adresi MongoDB Atlas IP access list'te kayıtlı. `db:indexes` başarıyla tamamlandı.
- [ ] Sözleşme testnet'te deploy edildi ve doğrulandı; `getDeployment(10143)` güncel adresi (`{{ESCROW_ADDRESS}}`) döndürüyor.
- [ ] `backend/api/.env`: `CHAIN_MODE=monad`, `DEMO_ALLOW_ANY_TIME=false`, `MONGODB_URI` ve `SETTLER_PRIVATE_KEY` dolu.
- [ ] Bakiyeler: Can ≥ 12 MON, settler ≥ 11 MON.
- [ ] `.\scripts\preflight.ps1` yeşil. Betik şunları kontrol eder: `GET /health` yanıt veriyor; `GET /config` `chainMode: "monad"` bildiriyor; `GET /chargers` simülatörü bağlı gösteriyor; settler bakiyesi en az 11 MON; zincirdeki `settler()` adresi `deployments` içindeki settler ile aynı.
- [ ] Frontend `VITE_API_MODE=live` ve `VITE_CHAIN_ID=10143` ile çalışıyor; iki Chrome profilinde Elif ve Can cüzdanları bağlı ve Monad Testnet seçili.
- [ ] Host node'u ve gelecekte başlayan slot arayüzden Atlas'a kaydedildi; slot `OPEN` durumunda.
- [ ] Explorer sekmeleri açık.
- [ ] Alternatif Monad testnet RPC adresi not edildi. Anvil yalnız geliştirici teşhisi için gerekirse ayrıca kullanılabilir.
