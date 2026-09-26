import { z } from "zod";

const blankToUndefined = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? undefined : value;

const EnvSchema = z.object({
  apiUrl: z.url().default("http://localhost:4000/api/v1"),
  apiMode: z.enum(["mock", "live"]).default("mock"),
  chainId: z.coerce
    .number()
    .pipe(z.union([z.literal(10143), z.literal(31337)]))
    .default(10143),
});

export type Env = z.infer<typeof EnvSchema>;
export type ApiMode = Env["apiMode"];

// NEXT_PUBLIC_* values are inlined at build time, so each one must be read with a
// literal `process.env.NAME` expression (no dynamic access).
export const env: Env = EnvSchema.parse({
  apiUrl: blankToUndefined(process.env.NEXT_PUBLIC_API_URL),
  apiMode: blankToUndefined(process.env.NEXT_PUBLIC_API_MODE),
  chainId: blankToUndefined(process.env.NEXT_PUBLIC_CHAIN_ID),
});
