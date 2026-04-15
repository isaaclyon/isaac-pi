export interface RequestAuth {
  apiKey: string;
  headers?: Record<string, string>;
}

export interface AuthLogger {
  error(message: string): void;
}

function toHeaders(value: unknown): Record<string, string> | undefined {
  return value != null && typeof value === "object" ? value as Record<string, string> : undefined;
}

export async function resolveRequestAuth(
  modelRegistry: any,
  model: any,
  logger: AuthLogger,
  label: string,
): Promise<RequestAuth | null> {
  if (typeof modelRegistry.getApiKeyAndHeaders === "function") {
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
    if (!auth || typeof auth.ok !== "boolean") {
      logger.error(`[LCM] Unexpected auth response shape for ${label}`);
      return null;
    }
    if (!auth.ok) return null;
    if (typeof auth.apiKey !== "string" || auth.apiKey.length === 0) {
      return null;
    }
    return {
      apiKey: auth.apiKey,
      headers: toHeaders(auth.headers),
    };
  }

  const apiKey = await modelRegistry.getApiKey(model);
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    return null;
  }

  return { apiKey };
}
