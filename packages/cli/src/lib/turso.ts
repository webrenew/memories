import { nanoid } from "nanoid";
import { getTursoApiToken } from "./env.js";

const API_BASE = "https://api.turso.tech/v1";

interface CreateDbResponse {
  database: {
    Name: string;
    DbId: string;
    Hostname: string;
  };
}

interface CreateTokenResponse {
  jwt: string;
}

async function api<T>(
  path: string,
  opts?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${getTursoApiToken()}`,
      "Content-Type": "application/json",
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Turso API error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

export async function createDatabase(org: string): Promise<{
  name: string;
  hostname: string;
  dbId: string;
}> {
  const name = `memories-${nanoid(8).toLowerCase()}`;

  const { database } = await api<CreateDbResponse>(
    `/organizations/${org}/databases`,
    {
      method: "POST",
      body: { name, group: "default" },
    }
  );

  return {
    name: database.Name,
    hostname: database.Hostname,
    dbId: database.DbId,
  };
}

export async function createDatabaseToken(
  org: string,
  dbName: string
): Promise<string> {
  const { jwt } = await api<CreateTokenResponse>(
    `/organizations/${org}/databases/${dbName}/auth/tokens`,
    { method: "POST" }
  );
  return jwt;
}
