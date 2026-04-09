import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(currentDir, "../../.env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf8");
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) {
      return;
    }

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  });
}

loadDotEnv();

export const LOCAL_DEV_MODE = process.env.LOCAL_DEV_MODE !== "false";

const SUPABASE_URL = String(
  process.env.RESCUENET_SUPABASE_URL || process.env.SUPABASE_URL || ""
).trim();
const SUPABASE_ANON_KEY = String(
  process.env.RESCUENET_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ""
).trim();

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Missing Supabase env. Copy .env.example to .env and fill in SUPABASE_URL/SUPABASE_ANON_KEY.");
}

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
