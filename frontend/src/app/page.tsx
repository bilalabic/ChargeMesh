import Link from "next/link";

export default function HomePage() {
  return (
    <section className="flex flex-col items-center gap-8 py-12 text-center">
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Gideceğin yerde şarj yerin hazır olsun.
        </h1>
        <p className="mx-auto max-w-xl text-slate-600">
          ChargeMesh, ofis ve site otoparklarındaki boşta duran AC şarj cihazlarını varacağın
          saate göre rezerve etmeni sağlar. Depozito ve hesaplaşma Monad üzerinde tutulur.
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
        <Link
          href="/host"
          className="flex-1 rounded-xl border border-slate-300 bg-white px-5 py-3 font-medium hover:border-emerald-600 hover:text-emerald-700"
        >
          Host olarak devam et
        </Link>
        <Link
          href="/driver"
          className="flex-1 rounded-xl bg-emerald-600 px-5 py-3 font-medium text-white hover:bg-emerald-700"
        >
          Sürücü olarak devam et
        </Link>
      </div>
    </section>
  );
}
