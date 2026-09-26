# @chargemesh/shared

Frontend, backend ve akıllı sözleşme ekipleri arasındaki ortak sözleşme paketi. Bir değerin iki tarafta farklı hesaplanması, ancak demo günü fark edilen türden hatalara yol açar. Bu paket o değerlerin tek bir yerde tanımlanmasını sağlar.

## İçerik

| Modül | Ne sağlar |
| --- | --- |
| `api/schemas.ts` | REST API'nin tüm istek ve yanıt modelleri (zod şeması + TypeScript tipi) |
| `api/enums.ts` | Durumlar, bağlantı ve erişim tipleri, hata kodları ve HTTP karşılıkları |
| `api/routes.ts` | Uç nokta yolları, `x-wallet-address` başlık adı |
| `ids.ts` | UUID'den zincir kimliği (`bytes32`) ve OCPP `idTag` üretimi |
| `units.ts` | Depozito ve hesaplaşma hesabı (sözleşmeyle birebir aynı tam sayı aritmetiği), gösterim yardımcıları |
| `matching.ts` | Deterministik eşleştirme algoritması (`rankMatches`) |
| `proof.ts` | Kanonik JSON ve Proof of Charge hash'i |
| `chain/eip712.ts` | Rezervasyon teklifinin EIP-712 tanımı ve `reserve()` argümanlarına dönüşümü |
| `chain/chains.ts` | Monad testnet ve Anvil ağ tanımları, explorer bağlantıları |
| `chain/abi.ts`, `chain/deployments.ts` | **Üretilen** dosyalar: sözleşme ABI'si ve deploy adresleri |
| `fixtures/` | Demo senaryosuyla birebir aynı örnek veriler (`createDemoFixtures`) |

## Kullanım

```ts
import { depositFor, formatMon, rankMatches, Reservation } from "@chargemesh/shared";
import { createDemoFixtures } from "@chargemesh/shared/fixtures";

formatMon(depositFor(20000, "10000000000000000")); // "0.2 MON"
```

Paket derlenmez; `exports` doğrudan TypeScript kaynaklarını gösterir. Next.js `transpilePackages` ile, API ve simülatör ise `tsx` ile tüketir.

## Komutlar

| Komut | Ne yapar |
| --- | --- |
| `corepack pnpm --filter @chargemesh/shared test` | Birim testleri (ücret, hash, eşleştirme, EIP-712, fixture'lar) |
| `corepack pnpm --filter @chargemesh/shared typecheck` | Tip kontrolü |
| `corepack pnpm --filter @chargemesh/shared chain:sync` | `contracts/out` ve `contracts/deployments` klasörlerinden `abi.ts` ile `deployments.ts` dosyalarını üretir |
| `corepack pnpm --filter @chargemesh/shared fixture:quote` | Sözleşmenin EIP-712 uyum testinde kullanılan imzalı teklifi üretir |

## Değişiklik kuralları

Bu paketteki bir değişiklik diğer ekiplerin kodunu doğrudan etkiler. Bu yüzden değişiklikler [sözleşme değişikliği protokolü](../../docs/07-paralel-calisma.md#sözleşme-değişikliği-protokolü) ile yapılır ve [değişiklik günlüğüne](../../docs/degisiklik-gunlugu.md) işlenir. Dosya bazında sahiplik için [AGENTS.md](AGENTS.md) dosyasına bakın.
