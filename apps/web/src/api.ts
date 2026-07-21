import { env } from "./config";
import { UserFacingError } from "./errors";
import { supabase } from "./supabase";

export class ApiError extends UserFacingError {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface ErrorPayload {
  error?: unknown;
  code?: unknown;
}

const GENERIC_ERROR = "Ocorreu um erro inesperado. Tente novamente em alguns instantes.";
const NETWORK_ERROR = "Não foi possível conectar. Verifique sua internet e tente novamente.";

function responseError(response: Response, payload: ErrorPayload): ApiError {
  const code = typeof payload.code === "string" ? payload.code : undefined;
  const serverMessage = typeof payload.error === "string" ? payload.error : undefined;

  if (response.status === 401) {
    return new ApiError("Sua sessão expirou. Entre novamente para continuar.", 401, code);
  }
  if (response.status === 403 && code !== "ONBOARDING_REQUIRED") {
    return new ApiError("Você não tem permissão para realizar esta ação.", 403, code);
  }
  if (response.status === 429) {
    return new ApiError("Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.", 429, code);
  }
  if (response.status === 503 && code === "ASSISTANT_UNAVAILABLE" && serverMessage) {
    return new ApiError(serverMessage, 503, code);
  }
  if (response.status >= 500) {
    return new ApiError(GENERIC_ERROR, response.status, code ?? "INTERNAL_ERROR");
  }

  return new ApiError(serverMessage ?? "Não foi possível concluir. Revise os dados e tente novamente.", response.status, code);
}

async function request<T>(path: string, init: RequestInit, authenticated: boolean): Promise<T> {
  const headers = new Headers(init.headers);
  if (authenticated) {
    const token = await accessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}${path}`, { ...init, headers });
  } catch (error) {
    console.error("API connection failed", error);
    throw new ApiError(NETWORK_ERROR, 0, "NETWORK_ERROR");
  }

  const payload = await response.json().catch(() => ({})) as ErrorPayload;
  if (!response.ok) throw responseError(response, payload);
  return payload as T;
}

async function accessToken(): Promise<string> {
  const { data, error } = (await supabase?.auth.getSession()) ?? { data: { session: null }, error: null };
  if (error) {
    console.error("Session retrieval failed", error);
    throw new ApiError("Sua sessão expirou. Entre novamente para continuar.", 401, "SESSION_ERROR");
  }
  return data.session?.access_token ?? "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, true);
}

export async function authenticatedFileUrl(path: string): Promise<string> {
  const token = await accessToken();
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${env.apiUrl}${path}`, { headers });
  } catch (error) {
    console.error("API connection failed", error);
    throw new ApiError(NETWORK_ERROR, 0, "NETWORK_ERROR");
  }

  if (response.redirected) return response.url;

  const payload = await response.json().catch(() => ({})) as ErrorPayload & { url?: unknown };
  if (!response.ok) throw responseError(response, payload);
  if (typeof payload.url !== "string" || !/^https?:\/\//.test(payload.url)) {
    throw new ApiError(GENERIC_ERROR, 500, "INVALID_FILE_URL");
  }
  return payload.url;
}

export async function publicApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, false);
}
