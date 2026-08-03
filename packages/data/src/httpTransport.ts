export type AccessTokenGetter = () => string | null | Promise<string | null>;
export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

/** Stable, body-free error surfaced by the self-hosted HTTP adapter. */
export class HttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "HttpError";
    this.code = code;
    this.status = status;
  }
}

export interface HttpRequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HttpStreamOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HttpTransport {
  request<T>(path: string, options?: HttpRequestOptions): Promise<T>;
  stream(path: string, options?: HttpStreamOptions): Promise<Response>;
}

export interface CreateHttpTransportOptions {
  baseUrl: string;
  getAccessToken: AccessTokenGetter;
  fetchImpl?: FetchImplementation;
}

function asHeaders(input: Record<string, string> | undefined): Record<string, string> {
  return input === undefined ? {} : { ...input };
}

function urlFor(baseUrl: string, path: string): string {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ""), root).toString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function parseErrorCode(response: Response): Promise<string> {
  let body: unknown = null;
  try {
    const text = await response.text();
    if (text.trim()) body = JSON.parse(text) as unknown;
  } catch {
    body = null;
  }
  if (
    isObject(body) &&
    typeof body.error === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(body.error)
  ) {
    return body.error;
  }
  return `http_${response.status}`;
}

async function asHttpError(response: Response): Promise<HttpError> {
  const code = await parseErrorCode(response);
  return new HttpError(code, response.status);
}

async function decodeJson<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new HttpError("invalid_json", response.status);
  }
  if (!text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError("invalid_json", response.status);
  }
}

function makeHeaders(
  accept: string,
  token: string | null,
  customHeaders?: Record<string, string>,
  hasBody = false,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    ...asHeaders(customHeaders),
  };
  if (hasBody && Object.keys(headers).every((name) => name.toLowerCase() !== "content-type")) {
    headers["Content-Type"] = "application/json";
  }
  if (token !== null && token !== "" && Object.keys(headers).every((name) => name.toLowerCase() !== "authorization")) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Build the small fetch surface shared by repository and authentication code.
 * Mutations are intentionally not retried here: retrying a POST/PATCH/DELETE
 * could duplicate a business write.
 */
export function createHttpTransport({
  baseUrl,
  getAccessToken,
  fetchImpl = (globalThis.fetch as unknown as FetchImplementation),
}: CreateHttpTransportOptions): HttpTransport {
  async function request<T>(path: string, options: HttpRequestOptions = {}): Promise<T> {
    const token = await getAccessToken();
    const hasBody = options.body !== undefined;
    const headers = makeHeaders("application/json", token, options.headers, hasBody);
    const response = await fetchImpl(urlFor(baseUrl, path), {
      method: options.method ?? "GET",
      headers,
      body: hasBody
        ? typeof options.body === "string"
          ? options.body
          : JSON.stringify(options.body)
        : undefined,
      signal: options.signal,
    });
    if (!response.ok) throw await asHttpError(response);
    return decodeJson<T>(response);
  }

  async function stream(path: string, options: HttpStreamOptions = {}): Promise<Response> {
    const token = await getAccessToken();
    const response = await fetchImpl(urlFor(baseUrl, path), {
      method: "GET",
      headers: makeHeaders("text/event-stream", token, options.headers),
      signal: options.signal,
    });
    if (!response.ok) throw await asHttpError(response);
    return response;
  }

  return { request, stream };
}

export interface SseFrame {
  event: string;
  id: string | undefined;
  data: string;
}

/** Parse an SSE response according to the browser event-stream line rules. */
export async function readSseStream(
  response: Response,
  onFrame: (frame: SseFrame) => void | Promise<void>,
  onReader?: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
): Promise<void> {
  if (response.body === null) throw new Error("SSE response has no body");
  const reader = response.body.getReader();
  onReader?.(reader);
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";
  let eventId: string | undefined;
  let dataLines: string[] = [];

  const dispatch = async (): Promise<void> => {
    if (dataLines.length === 0) {
      eventName = "";
      eventId = undefined;
      return;
    }
    const frame: SseFrame = {
      event: eventName || "message",
      id: eventId,
      data: dataLines.join("\n"),
    };
    eventName = "";
    eventId = undefined;
    dataLines = [];
    await onFrame(frame);
  };

  const consumeLine = async (rawLine: string): Promise<void> => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      await dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "id") eventId = value;
    else if (field === "data") dataLines.push(value);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        await consumeLine(line);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) await consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }
}
