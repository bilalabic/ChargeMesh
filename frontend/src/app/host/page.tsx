import Link from "next/link";
import { PageStub } from "@/components/page-stub";

export default function HostPage() {
  return (
    <PageStub
      title="Şarj noktalarım"
      description="Node'larını, çevrimiçi durumlarını ve yayındaki slotlarını burada göreceksin; tek tıkla demo verisi de oluşturabileceksin."
    >
      <Link href="/host/nodes/new" className="text-emerald-700 underline">
        Yeni node ekle
      </Link>
    </PageStub>
  );
}
