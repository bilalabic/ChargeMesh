# Sözleşme Değişiklik Günlüğü

API şemaları, akıllı sözleşme arayüzü, EIP-712 tanımı, Proof of Charge biçimi ve OCPP mesajlarında yapılan her değişiklik buraya en yeni en üstte olacak şekilde eklenir.

| Tarih | Sözleşme | Tür | Değişiklik | PR |
| --- | --- | --- | --- | --- |
| 2026-09-26 | Akıllı sözleşme | Ekleme | Güvenlik düzeltmesi (M-1): Reddedilen ödemeler artık işlemi geri almıyor, `pendingWithdrawal` hanesine yazılıyor. Yeni: `withdraw()`, `pendingWithdrawal(address)`, `PaymentDeferred`, `Withdrawn`, `NothingToWithdraw`, `RenounceDisabled`. `renounceOwnership` kapatıldı. Mevcut fonksiyon imzaları değişmedi. Frontend ve backend bekleyen alacak uyarısı eklemeli. | – |
| 2026-09-26 | Mimari | Netleştirme | `chainMode: "mock"` iken frontend'in cüzdan adımını atlayıp sahte hash'le `confirm` çağırması tanımlandı. | – |
| 2026-09-26 | Akıllı sözleşme | Netleştirme | Hata sırası tablosu, `settle` sonrası slotun dolu kalması ve `deployBlock` alt sınır tanımı eklendi (arayüz değişmedi). | – |
| 2026-09-26 | Tümü | İlk sürüm | v1.0 spesifikasyonu donduruldu. | – |
