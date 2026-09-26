import { PageStub } from "@/components/page-stub";

export default async function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <PageStub
      title="Proof of Charge"
      description="Oturum özeti, kanonik JSON ve hash'i tarayıcında yeniden hesaplayıp zincirdeki kayıt ve tutarlarla karşılaştıracağın doğrulama sayfası."
    >
      <p className="font-mono text-xs text-slate-500">{id}</p>
    </PageStub>
  );
}
