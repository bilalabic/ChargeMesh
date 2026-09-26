# 08 · Açık İşler

Bu liste, depodaki mevcut uygulama ve entegrasyon belgeleri kontrol edilerek 2026-09-26 tarihinde güncellenmiştir. Tamamlanmış temel özellikleri yeniden iş olarak saymaz; demo öncesi doğrulanması gerekenleri ve görünür ürün boşluklarını listeler.

## Öncelikli: testnet uçtan uca prova

- [ ] `docs/06-demo-senaryosu.md` akışını Monad testnet'te temiz MongoDB Atlas veritabanıyla baştan sona çalıştır: Host slotu, Sürücü rezervasyonu, OCPP oturumu, `settle` ve Proof of Charge.
- [ ] `scripts/preflight.ps1` çıktısını kaydet ve bloklayan bütün bağlantı, bakiye veya adres sorunlarını gider.
- [ ] Başarılı teslim yanında kısmi teslim akışını da provada doğrula; Host ödemesi ve sürücü iadesinin zincir ve arayüzde beklenen değerlerle eşleştiğini kontrol et.
- [ ] Yeni dağıtımın Sourcify / explorer doğrulamasını ve zincirdeki `settler()` eşleşmesini teyit et. Kaynak kodundaki güncel escrow `0x692Ee24f6CCeB942d2482e8c7405A8C46843DB98`, `deployBlock` alt sınırı `65843193`'tür. Önceki günlük kaydı olan `0x2541…70cf` artık güncel değildir.

## Frontend

- [ ] Monad testnet'te Host ve Sürücü cüzdanlarıyla canlı rezervasyon, iptal/expire ve çekim akışlarını prova et; `pendingWithdrawal(address)` bakiyesinin üst bantta görünmesini, `withdraw()` sonrasında yenilenmesini, explorer bağlantılarını ve hata metinlerini kontrol et.
- [ ] Masaüstünde iki cüzdan profiliyle demo akışını prova et; README hızlı başlangıcını temiz klondan izleyerek gerekli adımları doğrula.

## Backend ve entegrasyon

- [ ] Canlı Atlas + OCPP + Monad senaryosunda kesinti sonrası reconciliation davranışını doğrula; settle işlemi gönderildikten sonra API/DB kesilmesi durumunda kayıtların zincir durumuyla eşitlendiğini kontrol et.
- [ ] Demo için kullanılan settler bakiyesini ve sürücü bakiyesini demo öncesi kontrol et; sırların yalnızca yerel `.env` dosyalarında kaldığını doğrula.

## Sınır

Bu liste hackathon kapsamındaki tek uçtan uca demoyu tamamlamaya odaklanır. `docs/01-urun.md` içindeki “Yapılmayacaklar” listesine giren özellikler açık iş değildir.
