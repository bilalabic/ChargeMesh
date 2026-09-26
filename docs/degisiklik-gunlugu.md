# Sözleşme Değişiklik Günlüğü

API şemaları, akıllı sözleşme arayüzü, EIP-712 tanımı, Proof of Charge biçimi ve OCPP mesajlarında yapılan her değişiklik buraya en yeni en üstte olacak şekilde eklenir.

| Tarih | Sözleşme | Tür | Değişiklik | PR |
| --- | --- | --- | --- | --- |
| 2026-09-26 | Akıllı sözleşme | Ekleme | Gaz koruması: Kalan gaz tam ödeme payını iletmeye yetmiyorsa ödeme ertelenmez, işlem `InsufficientGas` ile geri alınır (statik analiz bulgusu). Yeni hata: `InsufficientGas`. Testnet'teki sözleşmede bu kontrol yeniden deploy edilene kadar yoktur. | – |
| 2026-09-26 | Paylaşılan paket | Ekleme | `shared/src/chain/` altına entegrasyon yardımcıları eklendi: `decodeEscrowError` ve `ESCROW_ERROR_MESSAGES_TR` (sözleşme hatalarına Türkçe mesaj), `OnchainStatus` ve `onchainStatusToReservationStatus`, `findReservationCreated`, `parseEscrowEvents`, `getEscrowEventsForReservation`. Kullanım örnekleri `docs/04-akilli-sozlesme.md` dosyasındaki "Entegrasyon rehberi" bölümünde. Mevcut dışa aktarımlar değişmedi. | – |
| 2026-09-26 | Akıllı sözleşme | Ekleme | Güvenlik düzeltmesi (M-1): Reddedilen ödemeler artık işlemi geri almıyor, `pendingWithdrawal` hanesine yazılıyor. Yeni: `withdraw()`, `pendingWithdrawal(address)`, `PaymentDeferred`, `Withdrawn`, `NothingToWithdraw`, `RenounceDisabled`. `renounceOwnership` kapatıldı. Mevcut fonksiyon imzaları değişmedi. Frontend ve backend bekleyen alacak uyarısı eklemeli. | – |
| 2026-09-26 | Mimari ve OCPP saklama | Değişiklik | Backend kalıcı veri katmanı PostgreSQL/Drizzle yerine resmi Node.js driver ile MongoDB Atlas olarak belirlendi; API ve OCPP wire sözleşmeleri değişmedi. | – |
| 2026-09-26 | Mimari | Netleştirme | `chainMode: "mock"` iken frontend'in cüzdan adımını atlayıp sahte hash'le `confirm` çağırması tanımlandı. | – |
| 2026-09-26 | Akıllı sözleşme | Netleştirme | Hata sırası tablosu, `settle` sonrası slotun dolu kalması ve `deployBlock` alt sınır tanımı eklendi (arayüz değişmedi). | – |
| 2026-09-26 | Tümü | İlk sürüm | v1.0 spesifikasyonu donduruldu. | – |
