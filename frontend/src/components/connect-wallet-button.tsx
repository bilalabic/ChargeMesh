"use client";

import { useConnect, useConnectors, useDisconnect } from "wagmi";
import { env } from "@/lib/env";
import { useWallet } from "@/lib/use-wallet";

const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export function ConnectWalletButton() {
  const { address, isConnected } = useWallet();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect.mutate()}
        title="Bağlantıyı kes"
        className="rounded-full border border-slate-300 px-3 py-1.5 font-mono text-sm text-slate-700 hover:bg-slate-100"
      >
        {shorten(address)}
      </button>
    );
  }

  const connector = connectors[0];
  return (
    <button
      type="button"
      disabled={!connector || connect.isPending}
      onClick={() => connector && connect.mutate({ connector, chainId: env.chainId })}
      className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
    >
      {connect.isPending ? "Bağlanıyor…" : "Cüzdanı bağla"}
    </button>
  );
}
