# Backend Uygulama Günlüğü

Bu dosya MongoDB Atlas tabanlı backend çalışmasının fazlarını, gerçek doğrulama sonuçlarını ve bilinen engelleri kaydeder. Gizli bağlantı bilgileri, özel anahtarlar ve `.env` içeriği buraya yazılmaz.

| Faz | Durum | Commit | Doğrulama |
| --- | --- | --- | --- |
| 1 · Mimari değişiklik protokolü | Tamamlandı | `docs: adopt mongodb atlas architecture` | Markdown ve kapsam incelemesi |
| 2 · Atlas veri katmanı | Tamamlandı | `refactor(backend): replace postgres with mongodb atlas` | API ve sim: typecheck, lint, test geçti |
| 3 · Host, slot, seed ve matching | Tamamlandı | `feat(backend): implement nodes slots and matching` | API ve sim: typecheck, lint, test geçti |
| 4 · Rezervasyon yaşam döngüsü | Tamamlandı | `feat(backend): implement reservation lifecycle` | API ve sim: typecheck, lint, test geçti |
| 5 · OCPP, oturum ve Proof of Charge | Tamamlandı | `feat(backend): complete OCPP charging sessions` | API ve sim: typecheck, lint, test geçti |
| 6 · M1 uçtan uca kabul | Bekliyor | `test(backend): cover mock demo workflow` | typecheck, lint, test, Atlas smoke (opsiyonel) |
| 7 · M2 Anvil entegrasyonu | Bekliyor | `test(backend): add anvil chain integration` | Anvil deployment varsa çalıştırılır |
| 8 · M3–M4 canlı mod ve kurtarma | Bekliyor | `fix(backend): harden settlement recovery and live mode` | mock/anvil; Monad işlemi ayrıca onay gerektirir |

## Faz 1 · Mimari değişiklik protokolü

- Kalıcı veri katmanı PostgreSQL/Drizzle'dan MongoDB Atlas ve resmi Node.js driver'a geçirildi.
- API, EIP-712, Proof of Charge ve OCPP wire biçimleri değiştirilmedi.
- Atlas URI'sinin yalnızca ortam değişkeninden okunacağı ve loglanmayacağı belgelendi.
- Testler bu fazda çalıştırılmadı; yalnızca Markdown ve değişiklik kapsamı incelendi.

## Faz 2 · Atlas veri katmanı

- PostgreSQL, Drizzle, migration ve yerel PostgreSQL Docker yapılandırması kaldırıldı.
- Resmi `mongodb` driver, Stable API bağlantısı, idempotent indeks hazırlığı ve OCPP counter eklendi.
- Üretimde `MongoStore`, ağsız testlerde aynı sözleşmeyi uygulayan `MemoryStore` kullanılıyor.
- `@chargemesh/api`: typecheck, lint ve 15 test geçti.
- `@chargemesh/charger-sim`: typecheck, lint ve 10 test geçti.
- Atlas URI sağlanmadığı için gerçek Atlas smoke testi bu fazda çalıştırılmadı.

## Faz 3 · Host, slot, seed ve matching

- Node oluşturma/listeleme, özel adres alanlarını yalnızca Host'a gösterme ve slot oluşturma/listeleme/kapatma uçları tamamlandı.
- Aynı node üzerindeki zaman çakışmaları reddediliyor; geçmiş slotlar oluşturulamıyor ve yalnızca sahibi slotu kapatabiliyor.
- Demo seed aynı Host için tekrar çalıştırıldığında yeni kayıt üretmiyor.
- Intent oluşturma/getirme ve `@chargemesh/shared` içindeki `rankMatches` ile deterministik eşleştirme tamamlandı.
- `@chargemesh/api`: typecheck, lint ve 18 test geçti.
- `@chargemesh/charger-sim`: typecheck, lint ve 10 test geçti.

## Faz 4 · Rezervasyon yaşam döngüsü

- Rezervasyon oluşturma, güncel eşleşmeyi yeniden doğruladıktan sonra EIP-712 teklifi imzalıyor.
- Slot claim ve reservation insert, `MongoStore` içinde sıralı DB çağrıları kullanan tek transaction olarak uygulanıyor.
- Confirm idempotent; reserve receipt/event doğrulaması başarılı olunca slot `RESERVED` oluyor.
- Driver/Host liste ve detay görünümleri eklendi; özel erişim bilgileri yalnızca onaylanmış rezervasyonun Driver'ına açılıyor.
- Zincirdeki `Reserved`, `Active`, `Settled`, `Cancelled` ve `Expired` durumları yerel kayda senkronize ediliyor; cancel/expire slotu yeniden açıyor.
- Eşzamanlı claim, confirm idempotency, erişim gizliliği ve cancel sync HTTP testleri eklendi.
- `@chargemesh/api`: typecheck, lint ve 22 test geçti.
- `@chargemesh/charger-sim`: typecheck, lint ve 10 test geçti.

## Faz 5 · OCPP, oturum ve Proof of Charge

- Kayıtlı olmayan charge point için `BootNotification` reddediliyor; kabul edilen cihaz ve connector durumu registry'ye işleniyor.
- OCPP CALL, CALLRESULT ve CALLERROR frame'leri yön, mesaj kimliği, eylem ve ham payload ile `ocppMessages` koleksiyonuna kaydediliyor.
- Session start/get/stop, artan OCPP transaction ID, meter sample saklama ve hedef enerjiye ulaşınca otomatik durdurma tamamlandı.
- `StartTransaction`, `MeterValues` ve `StopTransaction` akışı zincirde start/settle işlemleriyle bağlandı.
- Proof of Charge özeti, sample hash'i, kanonik JSON ve session hash yalnızca shared yardımcılarıyla üretiliyor; proof endpoint'i zincir hash'ini doğruluyor.
- SSE ilk `session.updated`, meter, settled, error ve 15 saniyelik ping olaylarını yayınlıyor.
- Kayıtlı/kayıtsız OCPP boot ve tam session → settlement → proof akışı test edildi.
- `@chargemesh/api`: typecheck, lint ve 24 test geçti.
- `@chargemesh/charger-sim`: typecheck, lint ve 10 test geçti.
