import Anthropic, { APIError, AuthenticationError, RateLimitError } from "@anthropic-ai/sdk";

const MODEL = "claude-opus-4-8";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    throw new Error("AI is not configured — set ANTHROPIC_API_KEY in your environment.");
  }
  client ??= new Anthropic();
  return client;
}

export async function askAI(
  messages: { role: "system" | "user"; content: string }[],
  model = MODEL,
): Promise<string> {
  // The Messages API takes the system prompt as a top-level field rather than a
  // message role, so split it out of the caller's list.
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns = messages
    .filter((m) => m.role === "user")
    .map((m) => ({ role: "user" as const, content: m.content }));

  if (!turns.length) throw new Error("askAI requires at least one user message.");

  try {
    const response = await getClient().messages.create({
      model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      ...(system ? { system } : {}),
      messages: turns,
    });

    if (response.stop_reason === "refusal") {
      throw new Error("The model declined this request. Try rephrasing the job description.");
    }

    // Responses may interleave thinking blocks with text; keep only the text.
    return response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
  } catch (error) {
    // Most specific first — RateLimitError and AuthenticationError both extend APIError.
    if (error instanceof RateLimitError) {
      throw new Error("Rate limit reached. Please try again in a moment.");
    }
    if (error instanceof AuthenticationError) {
      throw new Error("AI credentials are invalid. Check ANTHROPIC_API_KEY.");
    }
    if (error instanceof APIError) {
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
