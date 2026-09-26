# Sözleşme Değişiklik Günlüğü

API şemaları, akıllı sözleşme arayüzü, EIP-712 tanımı, Proof of Charge biçimi ve OCPP mesajlarında yapılan her değişiklik buraya en yeni en üstte olacak şekilde eklenir.

| Tarih | Sözleşme | Tür | Değişiklik | PR |
| --- | --- | --- | --- | --- |
| 2026-09-26 | Akıllı sözleşme | Deploy | Gaz korumalı sürüm Monad testnet'e yeniden deploy edildi: `0x2541cA7961fdBE38446b8081e7B92136dAE770cf` (blok 65835872, Sourcify'da doğrulandı). Eski adres `0x978b…13F3` artık kullanılmıyor. Adres `getDeployment(10143)` ile okunduğu için ekiplerin yalnızca `main`'i almaları yeterli. Testnet smoke testi (settle ve cancel akışları) başarıyla geçti. | – |
| 2026-09-26 | Akıllı sözleşme | Ekleme | Gaz koruması: Kalan gaz tam ödeme payını iletmeye yetmiyorsa ödeme ertelenmez, işlem `InsufficientGas` ile geri alınır (statik analiz bulgusu). Yeni hata: `InsufficientGas`. | – |
| 2026-09-26 | Paylaşılan paket | Ekleme | `shared/src/chain/` altına entegrasyon yardımcıları eklendi: `decodeEscrowError` ve `ESCROW_ERROR_MESSAGES_TR` (sözleşme hatalarına Türkçe mesaj), `OnchainStatus` ve `onchainStatusToReservationStatus`, `findReservationCreated`, `parseEscrowEvents`, `getEscrowEventsForReservation`. Kullanım örnekleri `docs/04-akilli-sozlesme.md` dosyasındaki "Entegrasyon rehberi" bölümünde. Mevcut dışa aktarımlar değişmedi. | – |
| 2026-09-26 | Akıllı sözleşme | Ekleme | Güvenlik düzeltmesi (M-1): Reddedilen ödemeler artık işlemi geri almıyor, `pendingWithdrawal` hanesine yazılıyor. Yeni: `withdraw()`, `pendingWithdrawal(address)`, `PaymentDeferred`, `Withdrawn`, `NothingToWithdraw`, `RenounceDisabled`. `renounceOwnership` kapatıldı. Mevcut fonksiyon imzaları değişmedi. Frontend ve backend bekleyen alacak uyarısı eklemeli. | – |
| 2026-09-26 | Mimari | Netleştirme | `chainMode: "mock"` iken frontend'in cüzdan adımını atlayıp sahte hash'le `confirm` çağırması tanımlandı. | – |
| 2026-09-26 | Akıllı sözleşme | Netleştirme | Hata sırası tablosu, `settle` sonrası slotun dolu kalması ve `deployBlock` alt sınır tanımı eklendi (arayüz değişmedi). | – |
| 2026-09-26 | Tümü | İlk sürüm | v1.0 spesifikasyonu donduruldu. | – |
