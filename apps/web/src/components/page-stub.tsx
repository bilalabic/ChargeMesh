import type { ReactNode } from "react";

/** Placeholder layout for M0 route stubs. */
export function PageStub({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-slate-600">{description}</p>
      {children}
    </section>
  );
}
