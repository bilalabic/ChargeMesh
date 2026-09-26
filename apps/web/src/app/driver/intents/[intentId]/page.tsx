import { PageStub } from "@/components/page-stub";

export default async function IntentMatchesPage({
  params,
}: {
  params: Promise<{ intentId: string }>;
}) {
  const { intentId } = await params;
  return (
    <PageStub
      title="Uygun şarj noktaları"
      description="Talebine en uygun slotlar bölge, mesafe, zaman penceresi, karşılanabilir enerji ve depozitoyla sıralanacak; buradan rezervasyon yapabileceksin."
    >
      <p className="font-mono text-xs text-slate-500">{intentId}</p>
    </PageStub>
  );
}
