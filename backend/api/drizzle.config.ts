import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://chargemesh:chargemesh@localhost:5433/chargemesh",
  },
  strict: true,
  verbose: true,
});
