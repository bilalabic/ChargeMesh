# Backend Uygulama Günlüğü

Bu dosya MongoDB Atlas tabanlı backend çalışmasının fazlarını, gerçek doğrulama sonuçlarını ve bilinen engelleri kaydeder. Gizli bağlantı bilgileri, özel anahtarlar ve `.env` içeriği buraya yazılmaz.

| Faz | Durum | Commit | Doğrulama |
| --- | --- | --- | --- |
| 1 · Mimari değişiklik protokolü | Tamamlandı | `docs: adopt mongodb atlas architecture` | Markdown ve kapsam incelemesi |
| 2 · Atlas veri katmanı | Bekliyor | `refactor(backend): replace postgres with mongodb atlas` | typecheck, lint, test |
| 3 · Host, slot, seed ve matching | Bekliyor | `feat(backend): implement nodes slots and matching` | typecheck, lint, test |
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
