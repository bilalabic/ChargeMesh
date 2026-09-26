import Link from "next/link";
import { ConnectWalletButton } from "./connect-wallet-button";

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold tracking-tight text-slate-900">
          Charge<span className="text-emerald-600">Mesh</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/host" className="text-slate-600 hover:text-slate-900">
            Host
          </Link>
          <Link href="/driver" className="text-slate-600 hover:text-slate-900">
            Sürücü
          </Link>
          <ConnectWalletButton />
        </nav>
      </div>
    </header>
  );
}
