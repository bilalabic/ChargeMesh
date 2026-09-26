import { PageStub } from "@/components/page-stub";

export default async function DriverReservationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <PageStub
      title="Rezervasyonum"
      description="Rezervasyonun durumunu, işlem bağlantılarını ve erişim bilgisini göreceğin; şarjı başlatıp canlı sayaçla izleyeceğin ve hesaplaşma sonucunu göreceğin sayfa."
    >
      <p className="font-mono text-xs text-slate-500">{id}</p>
    </PageStub>
  );
}
