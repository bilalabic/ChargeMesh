# shared: Ortak Sözleşme Paketi

Kök `AGENTS.md` kuralları geçerlidir. Bu paket, ekipler arasındaki **sözleşmedir**. Burada yapılan her değişiklik diğer ekiplerin kodunu etkiler.

| Dosya | Sahip | Değişiklik kuralı |
| --- | --- | --- |
| `src/api/**` | Backend | Protokol (`docs/07-paralel-calisma.md`) + `docs/03-api.md` güncellemesi |
| `src/ids.ts`, `src/units.ts`, `src/proof.ts`, `src/matching.ts`, `src/chain/eip712.ts`, `src/chain/chains.ts` | Ortak | Protokol + ilgili belge + etkilenen ekiplerin onayı |
| `src/chain/abi.ts`, `src/chain/deployments.ts` | Blockchain | **Elle düzenlenmez**, yalnızca `chain:sync` ile üretilir |
| `src/fixtures/**` | Frontend | Serbest; değerler `docs/06-demo-senaryosu.md` ile tutarlı kalmalı |

## Kurallar

- Paket derlenmez; `exports` doğrudan `.ts` kaynaklarını gösterir. Next.js `transpilePackages`, API ise `tsx` ile tüketir.
- Yalnızca platformdan bağımsız kod yazılır: DOM, Node, Fastify veya React bağımlılığı eklenmez (bağımlılıklar yalnızca `viem` ve `zod`).
- `units.ts` içindeki tam sayı aritmetiği sözleşmeyle birebir aynıdır. Değiştirirsen Solidity tarafını ve testleri de güncelle.
- Her değişiklikte `corepack pnpm --filter @chargemesh/shared typecheck` ve `test` yeşil olmalı. EIP-712 değişirse `fixture:quote` yeniden üretilir.
