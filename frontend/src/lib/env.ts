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

export const env: Env = EnvSchema.parse({
  apiUrl: blankToUndefined(import.meta.env.VITE_API_URL),
  apiMode: blankToUndefined(import.meta.env.VITE_API_MODE),
  chainId: blankToUndefined(import.meta.env.VITE_CHAIN_ID),
});
