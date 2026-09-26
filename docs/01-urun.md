# 01 · Ürün Tanımı ve Kapsam

> Sürüm: v1.0 (spesifikasyon donduruldu) · Sahibi: entegrasyon sorumlusu
> Bu belge, ekiplerin "ne yapıyoruz?" sorusuna verdiği ortak cevaptır. Kapsam değişikliği bu belge güncellenmeden koda yansımaz.

## Tek cümlede ChargeMesh

**ChargeMesh turns underused chargers into reservable charging capacity near where drivers are already going.**

Otoparklarda, ofislerde ve otellerde gün boyu boşta bekleyen AC şarj cihazlarının atıl kapasitesini, sürücünün zaten gideceği yerde rezerve edilebilir hale getiriyoruz. Sürücü uzun bir cihaz listesinde gezinmez; nereye gideceğini, orada ne kadar kalacağını ve ne kadar enerjiye ihtiyaç duyduğunu söyler. Sistem ona uygun noktayı bulur. Şarj oturumu ölçülür, sonuç kaydedilir ve ödeme gerçekten aktarılan enerjiye göre kapanır.

## Çözdüğümüz problem

- Destinasyon şarj cihazları (ofis, otel, site, özel otopark) günün büyük bölümünde boştadır; sahipleri bu kapasiteyi güvenle paylaşmanın bir yolunu bulamaz.
- Sürücü için asıl mesele "hangi cihaz boşta?" sorusu değildir. Asıl mesele, "Gideceğim yerde, kalacağım süre içinde ihtiyacım olan enerjiyi alabilecek miyim?" sorusudur.
- Paylaşımlı kullanımda güven sorunu vardır: Ne kadar enerji alındı, ne kadar ödenmeli, anlaşmazlık olursa kayıt nerede?

## Roller

| Rol | Kim | Ne yapar |
| --- | --- | --- |
| **Host** | Cihaz sahibi veya işletmecisi | Şarj noktasını tanımlar (bağlantı tipi, güç, erişim koşulu), uygun saat aralıklarını ve kapasitesini **Energy Slot** olarak yayınlar, gelen rezervasyonları görür ve karşılığında ödeme alır. |
| **Sürücü** (kodda `Driver`) | Elektrikli araç sürücüsü | Gideceği yeri, varış ve ayrılış saatini, ihtiyaç duyduğu enerjiyi girer. Önerilen noktalardan birini seçip depozitoyla rezerve eder, noktaya varınca QR ile oturumu başlatır ve sonuç özetini görür. |

İlk hedef, erişimi yönetilebilen destinasyonlardaki cihazlardır: ofis, otel, apartman ve özel otoparklar. Ev tipi cihazlar sonraki sürümlerde değerlendirilecek.

## Sözlük

Aşağıdaki terimler kodda ve dokümanlarda **aynen** kullanılır. Tip, koleksiyon ve değişken adları İngilizce kalır. Arayüz metinlerinde ve belgelerin düz metninde "Arayüz karşılığı" sütunundaki ad kullanılır.

| Terim | Kod karşılığı | Arayüz karşılığı | Anlamı |
| --- | --- | --- | --- |
| Host | `host` | Host | Şarj noktasını paylaşan ve karşılığında ödeme alan taraf. |
| Driver | `driver` | Sürücü | Rezervasyon yapan, depozito yatıran ve şarj olan taraf. |
| Charging Node | `ChargingNode` / `nodes` | Şarj noktası | Host'un tanımladığı fiziksel şarj noktası. Bir OCPP charge point ve bir konektöre karşılık gelir. |
| Energy Slot | `EnergySlot` / `slots` | Energy Slot | Bir node'un belirli bir zaman aralığında sunduğu kapasite: başlangıç, bitiş, en fazla enerji (Wh), kWh fiyatı. |
| Charge Intent | `ChargeIntent` / `intents` | Şarj talebi | Sürücünün talebi: hedef konum, varış, ayrılış, istenen enerji, bağlantı tipi. |
| Match | `MatchResult` | Eşleşme | Bir intent için sıralanmış uygun slot önerisi. |
| Reservation | `Reservation` / `reservations` | Rezervasyon | Onaylanmış eşleşme. Zincirde depozitoyla birlikte kaydedilir. |
| Charging Session | `ChargingSession` / `sessions` | Şarj oturumu | QR ile başlayan, OCPP üzerinden ölçülen gerçek şarj oturumu. |
| Proof of Charge | `ProofOfCharge` | Proof of Charge | Oturum özetinin kanonik JSON'u ve bu JSON'un keccak256 hash'i. Hash zincire yazılır. |
| Settlement | `settle` | Hesaplaşma | Aktarılan enerjiye göre depozitonun Host'a ödenen ve Sürücü'ye iade edilen kısımlara ayrılması. |
| Withdrawal | `pendingWithdrawal` / `withdraw()` | Bekleyen ödeme | Doğrudan gönderilemediği için sözleşmede bekleyen ödeme. Sahibi istediği zaman `withdraw()` ile çeker. |
| Settler | `settler` | Settler | Teklifleri imzalayan ve oturum sonucunu zincire yazan backend anahtarı. |

## Temel akış

1. **Host bir Charging Node ekler** ve kullanılabilir zaman aralığıyla kapasitesini içeren bir **Energy Slot** yayınlar.
2. **Sürücü bir Charge Intent oluşturur:** hedef konum, varış, ayrılış ve istenen kWh.
3. **Sistem slotları sıralar.** Bağlantı uyumu, erişim tipi, mesafe ve o zaman aralığında karşılanabilecek enerji dikkate alınır. Sıralama deterministiktir: aynı girdi her zaman aynı sonucu verir (bkz. [03-api.md](03-api.md#eşleştirme-algoritması)).
4. **Sürücü seçimini onaylar.** Backend imzalı bir teklif (EIP-712 quote) üretir. Sürücü bu teklifi cüzdanıyla Monad testnet'teki sözleşmeye gönderir ve depozitoyu kilitler. Böylece rezervasyon zincire kaydedilmiş olur.
5. **Sürücü noktaya varınca** oturumu QR ile başlatır. Hackathon demosunda telefon kullanılmaz: QR kodu Host ekranında görsel olarak durur, Sürücü aynı dizüstü bilgisayarda "Şarjı başlat" düğmesine basar (bkz. [06-demo-senaryosu.md](06-demo-senaryosu.md)).
6. **OCPP simülatörü** oturumu ve sayaç verilerini backend'e iletir. Backend, talep edilen enerjiyle aktarılan enerjiyi karşılaştırır, Proof of Charge özetini oluşturur ve hash'ini `settle` çağrısıyla zincire yazar. Sözleşme aktarılan enerjinin bedelini Host'a gönderir, kalan depozitoyu da Sürücü'ye iade eder. Alıcılardan biri ödemeyi reddederse işlem geri alınmaz: Tutar alıcının çekilebilir bakiyesine (`pendingWithdrawal`) eklenir, alıcı da parasını istediği zaman `withdraw()` ile çeker (bkz. [04-akilli-sozlesme.md](04-akilli-sozlesme.md#ödeme-modeli)).

### Enerji rezervasyonu ne demek, ne demek değil?

- Enerji rezervasyonu, belirli bir zaman aralığında hedeflenen kWh için yapılan **kapasite planlamasıdır**.
- Bir fiziksel soket aynı anda birden fazla araca tahsis edilmez. Hackathon sürümünde **bir Energy Slot yalnızca bir rezervasyon alır**.
- Hedeflenen miktar kesin teslimat garantisi değildir. Araç, batarya ve şebeke koşulları teslim edilen enerjiyi etkileyebilir. Bu yüzden ödeme **talep edilene göre değil, gerçekleşene göre** kapanır.

## Zincir ve veri sınırı

| Nerede | Ne tutulur |
| --- | --- |
| **Uygulama sunucusu (MongoDB Atlas)** | Node ve slot ayrıntıları, açık adres ve konum, eşleştirme, erişim talimatları, OCPP mesajları, ham sayaç kayıtları, oturum özeti (kanonik JSON). |
| **Monad testnet** | Rezervasyon taahhüdü (slot referansı, taraflar, istenen Wh, fiyat, zaman penceresi), depozito kilidi, oturumun başlaması, oturum sonucu (aktarılan Wh), hesaplaşma tutarları ve oturum özetinin hash'i. |

Gizlilik kuralları:

- Açık adres, araç veya kişi bilgisi ve ham sayaç akışı **zincire yazılmaz**.
- Zincirdeki kimlikler opak `bytes32` değerlerdir (`keccak256("reservation:" + uuid)` gibi). Bunlardan adres ya da konum çıkarılamaz.
- Açık adres ve özel erişim talimatı yalnızca **onaylanmış rezervasyonun sürücüsüne** gösterilir. Eşleştirme sonuçlarında yalnızca bölge etiketi ve yaklaşık mesafe görünür.

> Simülatörden gelen ölçüm, gerçek donanımdan bağımsız olarak doğrulanmış bir enerji teslimi anlamına gelmez. Demo, ölçüme dayalı kayıt ve hesaplaşma akışının nasıl işlediğini gösterir.

## Hackathon kapsamı

### Yapılacaklar

- İki rol (Host ve Sürücü) için sade bir web arayüzü
- Sanal bir cihaz ekleme ve slot yayınlama
- Talep girme ve deterministik eşleştirme
- Monad testnet üzerinde imzalı teklifle depozitolu rezervasyon
- QR ile oturum başlatma (demoda tek dizüstü bilgisayar kullanılır; QR ekranda görsel olarak durur)
- OCPP 1.6J simülasyonu (başlatma, periyodik sayaç, durdurma)
- Proof of Charge özeti ve test ödemesinin gerçekleşen kullanıma göre sonuçlandırılması

Demo **tek bir başarılı uçtan uca senaryoya** odaklanır. Yedek olarak, aracın talep edilenden az enerji aldığı "kısmi teslim" senaryosu da gösterilebilir (bkz. [06-demo-senaryosu.md](06-demo-senaryosu.md)).

### Yapılmayacaklar

Gerçek cihaz entegrasyonu, gerçek para tahsilatı, birden çok operatör, otomatik yedek eşleştirme, community pool, dinamik fiyatlandırma, rota planlama, güneş enerjisi veya V2G, yapay zekâ, DAO, NFT, özel token, güvenilirlik puanı ve alternatif nokta önerisi.

Bu listeden bir şey koda girecekse önce bu belge güncellenmelidir.

### Bilinçli olarak basit tutulanlar

- **Kimlik doğrulama:** Kullanıcı kimliği, bağlı cüzdan adresidir ve `x-wallet-address` başlığıyla gönderilir. Bu yöntem güvenli değildir ve yalnızca demo içindir (bkz. [03-api.md](03-api.md#kimlik)).
- **Platform komisyonu:** Yoktur. Ödenen bedelin tamamı Host'a gider.
- **Gelmeyen sürücü (no-show):** Ceza uygulanmaz; süre dolan rezervasyonda depozitonun tamamı iade edilir.

## Ticari sürüme geçerken

Cihaz erişimi, ölçüm güvenliği (imzalı sayaç verisi, kalibrasyon), ödeme altyapısı ve şarj hizmetine ilişkin yasal yükümlülükler ayrıca doğrulanmalıdır. Hackathon sürümü gerçek bir şarj hizmeti sunmaz.
