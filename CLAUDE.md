@AGENTS.md

## Claude Code'a özel notlar

- Bu projede alan başına hazır alt ajanlar vardır: `web-dev`, `api-dev`, `contracts-dev`, `integrator` (`.claude/agents/`). Bir alanda iş yaparken ilgili ajanın kurallarına uy.
- Paralel çalışmada her ajan kendi git worktree'sinde başlatılır (`docs/07-paralel-calisma.md`). Oturumu doğrudan ilgili worktree klasöründe aç.
- Kütüphane API'lerinde (Next.js 16, wagmi 3, viem 2, Fastify 5, Drizzle, zod 4, ocpp-rpc, Foundry) emin değilsen Context7 ile güncel belgeye bak. API uydurma.
