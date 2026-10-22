// AI-powered password idea generation for Persora's built-in generator.
// Uses the same Cloudflare Workers AI binding (`env.AI`) and extraction model as
// Smart Scan. The model only proposes memorable word/phrase material — every
// final password is composed locally from these candidates with
// cryptographically secure random picks, so the AI is never a randomness source
// and no user vault data is ever sent to it (the request carries only public
// style parameters).
export const AI_PASSWORD_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const AI_PASSWORD_STYLES = new Set(["rhythmic", "pronounceable", "poetic", "sonnet", "passphrase"]);

export class AIPasswordError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Validates + sanitizes raw model output. Only plain, printable password
// material ever reaches the client; control characters, markup, prompts, and
// over-long blobs are dropped. Exported for unit tests.
export function sanitizeAiPasswordCandidates(value, { maxCount = 6, maxLength = 72 } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const cleaned = entry
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 4 || cleaned.length > maxLength) continue;
    // Letter-led, plain characters only: letters, digits, spaces, and a small
    // set of separators. Anything else (script injection, emoji, unicode tricks)
    // is rejected rather than mutated.
    if (!/^[A-Za-z][A-Za-z0-9 .'_-]*$/.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= maxCount) break;
  }
  return output;
}

function extractJsonObject(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    // Fall through to object extraction from wrapped prose/markdown.
  }
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(source.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Workers AI's chat models return { response: string, usage: {...} }. Accept
// equivalent text-bearing envelopes too, while keeping parsed provider output
// separate from the usage metadata (which must never be treated as candidates).
function modelResponseText(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (typeof value.response === "string") return value.response;
  if (typeof value.output_text === "string") return value.output_text;
  const choiceContent = value.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string") return choiceContent;
  return "";
}

const STYLE_GUIDANCE = {
  rhythmic: "Pairs of short rhyming or alliterative words with a strong beat (e.g. 'drift swift', 'lunar tuner'). Two or three beats, no full sentences.",
  pronounceable: "Invented but easy-to-pronounce words with natural consonant-vowel flow (e.g. 'veratilo', 'sondripe'). They must NOT be real dictionary words.",
  poetic: "Evocative two-to-four word image pairings (e.g. 'amber horizon', 'quiet thunder'). Vivid, clean imagery only.",
  sonnet: "Short fragments in the style of classic English poetry (e.g. 'the silver dawn', 'where robins dwell'). Timeless vocabulary, never ornate nonsense.",
  passphrase: "Three to five uncommon everyday words that are easy to spell and type (e.g. 'cobalt river lantern'). Absolutely no famous quotes, lyrics, or idioms.",
};

export function validateAiPasswordRequest(body) {
  const style = typeof body?.style === "string" ? body.style.trim().toLowerCase() : "";
  if (!AI_PASSWORD_STYLES.has(style)) throw new AIPasswordError("Choose a valid AI suggestion style.");
  const countRaw = Number(body?.count);
  const count = Number.isInteger(countRaw) && countRaw >= 1 && countRaw <= 6 ? countRaw : 4;
  const lengthRaw = Number(body?.maxLength);
  const maxLength = Number.isInteger(lengthRaw) && lengthRaw >= 8 && lengthRaw <= 64 ? lengthRaw : 32;
  return { style, count, maxLength };
}

// Returns sanitized candidate strings. Throws AIPasswordError(503) when the AI
// binding is unavailable or the model returns unusable output, so the route (and
// then the client) can fall back to fully local generation without friction.
export async function aiPasswordCandidates(env, options) {
  const { style, count, maxLength } = validateAiPasswordRequest(options);
  if (!env?.AI || typeof env.AI.run !== "function") {
    console.error("Persora Workers AI password binding is unavailable", { binding: "AI", model: AI_PASSWORD_MODEL });
    throw new AIPasswordError("The Cloudflare Workers AI binding is not configured for this Pages environment.", 503);
  }

  const messages = [
    {
      role: "system",
      content: [
        "You create candidate building blocks for memorable passwords.",
        "You only ever see public style parameters — never user account data, never existing passwords.",
        "Reply with one JSON object of the form {\"candidates\": [string, ...]} and nothing else.",
        "Every candidate: 4-72 characters, English letters with optional spaces/hyphens/dots, no markup, no code, no quotes or lyrics, no personal data, nothing offensive.",
        "Candidates are raw material only; they are mixed with cryptographically secure random characters before use, so do not add random digits or symbols yourself.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "password_material",
        style,
        guidance: STYLE_GUIDANCE[style],
        candidates: count + 2,
        maxLength: Math.min(48, Math.max(18, maxLength)),
      }),
    },
  ];

  const startedAt = Date.now();
  let response;
  try {
    response = await env.AI.run(AI_PASSWORD_MODEL, {
      messages,
      max_tokens: 320,
      temperature: 0.9,
      response_format: { type: "json_object" },
    });
  } catch (error) {
    // Do not log prompts, candidate strings, or account identifiers. The
    // provider message and duration are enough to correlate a failure in Pages
    // real-time logs with Workers AI's execution/neuron metrics.
    console.error("Persora Workers AI password request failed", {
      model: AI_PASSWORD_MODEL,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown provider error",
    });
    throw new AIPasswordError("Cloudflare Workers AI did not complete the suggestion request.", 503);
  }
  const parsed = extractJsonObject(modelResponseText(response));
  const candidates = sanitizeAiPasswordCandidates(parsed?.candidates, { maxCount: count, maxLength: 72 });
  if (!candidates.length) {
    console.error("Persora Workers AI returned no usable password suggestions", {
      model: AI_PASSWORD_MODEL,
      elapsedMs: Date.now() - startedAt,
      responseType: typeof response,
      hasResponseText: Boolean(modelResponseText(response)),
      hasUsage: Boolean(response && typeof response === "object" && response.usage),
    });
    throw new AIPasswordError("Cloudflare Workers AI completed but returned no usable suggestions.", 503);
  }
  console.info("Persora Workers AI password request succeeded", {
    model: AI_PASSWORD_MODEL,
    elapsedMs: Date.now() - startedAt,
    candidateCount: candidates.length,
    neurons: Number.isFinite(Number(response?.usage?.neuron_count)) ? Number(response.usage.neuron_count) : undefined,
  });
  return candidates;
}
