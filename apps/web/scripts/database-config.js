const databaseTlsParameters = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslnegotiation",
  "uselibpqcompat",
]);

function requiredEnvironmentValue(environment, name) {
  const value = environment[name]?.trim();
  if (value !== undefined && value !== "") return value;
  throw Object.assign(new Error(`${name} is required`), {
    code: `CONFIG_${name}_MISSING`,
  });
}

export function databaseSslEnabled(environment = process.env) {
  const value = requiredEnvironmentValue(environment, "VIBERACING_DATABASE_SSL");
  if (value === "true") return true;
  if (value === "false") return false;
  throw Object.assign(new Error("VIBERACING_DATABASE_SSL must be true or false"), {
    code: "CONFIG_DATABASE_SSL_INVALID",
  });
}

export function databaseClientConfig(environment = process.env) {
  const connectionString = requiredEnvironmentValue(environment, "DATABASE_URL");
  const useTls = databaseSslEnabled(environment);
  let url;
  try {
    url = new globalThis.URL(connectionString);
  } catch {
    throw Object.assign(new Error("DATABASE_URL must be a valid PostgreSQL URL"), {
      code: "CONFIG_DATABASE_URL_INVALID",
    });
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw Object.assign(new Error("DATABASE_URL must use the PostgreSQL protocol"), {
      code: "CONFIG_DATABASE_URL_INVALID",
    });
  }
  for (const name of url.searchParams.keys()) {
    if (databaseTlsParameters.has(name.toLowerCase())) {
      throw Object.assign(new Error("DATABASE_URL must not override VIBERACING_DATABASE_SSL"), {
        code: "CONFIG_DATABASE_URL_SSL_CONFLICT",
      });
    }
  }
  return {
    connectionString,
    ssl: useTls ? { rejectUnauthorized: true } : false,
  };
}
