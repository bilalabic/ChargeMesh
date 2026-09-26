import { PageStub } from "@/components/page-stub";

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<{ cp?: string | string[]; c?: string | string[] }>;
}) {
  const { cp, c } = await searchParams;
  return (
    <PageStub
      title="Şarjı başlat"
      description="Cihazdaki QR kodu okuttuğunda bu noktadaki rezervasyonunu bulup şarj oturumunu başlatacağız."
    >
      {cp ? (
        <p className="font-mono text-xs text-slate-500">
          {String(cp)} · {String(c ?? "1")}
        </p>
      ) : null}
    </PageStub>
  );
}
