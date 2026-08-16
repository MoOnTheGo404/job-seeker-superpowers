import { GoogleGenAI, ApiError } from "@google/genai";
import { runtimeEnv } from "./env";

/*
 * Gemini's free tier covers both jobs this app does (parsing a posting and
 * drafting outreach).
 *
 * Deliberately an alias, not a pinned version. Pinned IDs get retired out from
 * under you — `gemini-2.0-flash` and `gemini-2.5-flash` both already 404 for
 * new keys. `-latest` tracks the current flash model instead. Override with
 * GEMINI_MODEL if you want to pin one anyway.
 */
const DEFAULT_MODEL = "gemini-flash-latest";

/** Transient statuses worth retrying: capacity, gateway blips, rate windows. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;

/**
 * The SDK puts the raw JSON error envelope in `message`. Pull the human
 * sentence out of it so users see the reason, not a wall of braces.
 */
function humanMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message.slice(0, 300);
  } catch {
    // Not JSON — fall through and use it as-is.
  }
  return raw.slice(0, 300);
}

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  const apiKey = runtimeEnv("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("AI is not configured — set GEMINI_API_KEY in your environment.");
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export async function askAI(
  messages: { role: "system" | "user"; content: string }[],
  options: { json?: boolean; model?: string; thinking?: boolean } = {},
): Promise<string> {
  // Gemini takes the system prompt as its own config field rather than a message
  // role, so split it out of the caller's list.
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");

  if (!userText) throw new Error("askAI requires at least one user message.");

  /*
   * `||`, not `??`. A declared-but-blank `GEMINI_MODEL=` in .env is an empty
   * string, which `??` happily passes through — the API then rejects the
   * request with "model is required and must be a string". Trim and treat
   * blank as unset so an empty line in .env means "use the default".
   */
  const model = options.model?.trim() || runtimeEnv("GEMINI_MODEL")?.trim() || DEFAULT_MODEL;

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await getClient().models.generateContent({
        model,
        contents: userText,
        config: {
          maxOutputTokens: 4096,
          ...(system ? { systemInstruction: system } : {}),
          // Asking for JSON natively is far more reliable than stripping code
          // fences off prose afterwards. parseJsonBlock stays as a safety net.
          ...(options.json ? { responseMimeType: "application/json" } : {}),
          // Thinking is on by default. Straight extraction gains nothing from it
          // and pays ~9x the latency (measured: 7.9s vs 0.9s), so callers doing
          // pure field-pulling opt out. Anything that writes prose leaves it on.
          ...(options.thinking === false ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error("The model returned an empty response. Try again in a moment.");
      }
      return text;
    } catch (error) {
      lastError = error;

      // 503 (capacity) and 5xx are transient and clear on their own; a shared
      // free tier hits them regularly. Back off and retry rather than making
      // the user re-click. 429 is included because the free tier's per-minute
      // window recovers quickly, though a daily cap will still exhaust retries.
      const retryable = error instanceof ApiError && RETRYABLE_STATUS.has(error.status);
      if (retryable && attempt < MAX_ATTEMPTS) {
        const backoffMs = 700 * 2 ** (attempt - 1) + Math.random() * 300;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        continue;
      }
      break;
    }
  }

  const error = lastError;
  if (error instanceof ApiError) {
    if (error.status === 429) {
      throw new Error(
        "Rate limit reached. The Gemini free tier has per-minute and daily caps — wait a moment and try again.",
      );
    }
    if (RETRYABLE_STATUS.has(error.status)) {
      throw new Error(
        `Gemini is busy right now (${error.status}). This is usually brief — try again in a moment.`,
      );
    }
    // Gemini reports a bad key as 400 INVALID_ARGUMENT rather than 401/403,
    // so match on the message too — otherwise a typo'd key surfaces as an
    // opaque "request failed [400]".
    if (
      error.status === 401 ||
      error.status === 403 ||
      /api key not valid|api_key_invalid/i.test(error.message)
    ) {
      throw new Error("AI credentials are invalid or lack access. Check GEMINI_API_KEY.");
    }
    throw new Error(`AI request failed [${error.status}]: ${humanMessage(error.message)}`);
  }
  throw error;
}

export function parseJsonBlock<T>(text: string, fallback: T): T {
  const cleaned = text
    .replace(/^```(?:json)?/gm, "")
    .replace(/```$/gm, "")
    .trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return fallback;
  const slice = cleaned.slice(start);
  try {
    return JSON.parse(slice) as T;
  } catch {
    const lastBrace = Math.max(slice.lastIndexOf("}"), slice.lastIndexOf("]"));
    try {
      return JSON.parse(slice.slice(0, lastBrace + 1)) as T;
    } catch {
      return fallback;
    }
  }
}
