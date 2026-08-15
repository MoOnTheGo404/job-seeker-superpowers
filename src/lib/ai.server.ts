import { GoogleGenAI, ApiError } from "@google/genai";

/*
 * Gemini's free tier covers both jobs this app does (parsing a posting and
 * drafting outreach). Model IDs move faster than this file will, so the default
 * is overridable with GEMINI_MODEL rather than hard-coded at the call sites.
 */
const DEFAULT_MODEL = "gemini-2.0-flash";

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) {
    throw new Error("AI is not configured — set GEMINI_API_KEY in your environment.");
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export async function askAI(
  messages: { role: "system" | "user"; content: string }[],
  options: { json?: boolean; model?: string } = {},
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

  try {
    const response = await getClient().models.generateContent({
      model: options.model ?? process.env["GEMINI_MODEL"] ?? DEFAULT_MODEL,
      contents: userText,
      config: {
        maxOutputTokens: 4096,
        ...(system ? { systemInstruction: system } : {}),
        // Asking for JSON natively is far more reliable than stripping code
        // fences off prose afterwards. parseJsonBlock stays as a safety net.
        ...(options.json ? { responseMimeType: "application/json" } : {}),
      },
    });

    const text = response.text?.trim();
    if (!text) {
      throw new Error("The model returned an empty response. Try again in a moment.");
    }
    return text;
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429) {
        throw new Error(
          "Rate limit reached. The Gemini free tier has per-minute and daily caps — wait a moment and try again.",
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
      throw new Error(`AI request failed [${error.status}]: ${error.message.slice(0, 300)}`);
    }
    throw error;
  }
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
