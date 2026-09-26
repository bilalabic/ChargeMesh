import { PageStub } from "@/components/page-stub";

export default async function NodeDetailPage({
  params,
}: {
  params: Promise<{ nodeId: string }>;
}) {
  const { nodeId } = await params;
  return (
    <PageStub
      title="Node ayrıntısı"
      description="Slot yayınlayacağın, slotları ve gelen rezervasyonları izleyeceğin, cihaza yapıştırılacak QR kodu yazdıracağın sayfa."
    >
      <p className="font-mono text-xs text-slate-500">{nodeId}</p>
    </PageStub>
  );
}
