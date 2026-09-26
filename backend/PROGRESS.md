# Backend Uygulama Günlüğü

Bu dosya MongoDB Atlas tabanlı backend çalışmasının fazlarını, gerçek doğrulama sonuçlarını ve bilinen engelleri kaydeder. Gizli bağlantı bilgileri, özel anahtarlar ve `.env` içeriği buraya yazılmaz.

| Faz | Durum | Commit | Doğrulama |
| --- | --- | --- | --- |
| 1 · Mimari değişiklik protokolü | Tamamlandı | `docs: adopt mongodb atlas architecture` | Markdown ve kapsam incelemesi |
| 2 · Atlas veri katmanı | Tamamlandı | `refactor(backend): replace postgres with mongodb atlas` | API ve sim: typecheck, lint, test geçti |
| 3 · Host, slot, seed ve matching | Tamamlandı | `feat(backend): implement nodes slots and matching` | API ve sim: typecheck, lint, test geçti |
| 4 · Rezervasyon yaşam döngüsü | Bekliyor | `feat(backend): implement reservation lifecycle` | typecheck, lint, test |
| 5 · OCPP, oturum ve Proof of Charge | Bekliyor | `feat(backend): complete OCPP charging sessions` | typecheck, lint, test |
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
