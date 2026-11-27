import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PhotoAssessmentSchema, type PhotoAssessment } from "./schema";
import type { ImageMediaType } from "./image-type";

export type PhotoMediaType = ImageMediaType;
export type PhotoInput = { url: string } | { base64: string; mediaType: PhotoMediaType };

export interface PhotoContext {
  address?: string;
  sqft?: number;
  beds?: number;
  baths?: number;
  yearBuilt?: number;
  submarket?: string;
}

export const MAX_PHOTOS = 16;

/** The assessment, and what reading it cost: logged with every analysis (lib/usage). */
export interface PhotoReading {
  assessment: PhotoAssessment;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * The photo reading did not produce an assessment. `message` is written for
 * the person who asked; the service's own error stays in `cause`, for the log.
 * `billed` says whether an answer was generated (and paid for) before it went
 * wrong: a refusal or a cut-off answer is billed, a request the AI service
 * rejected or never received is not. The monthly allowance counts only the
 * billed ones (lib/usage).
 */
export class PhotoReadError extends Error {
  billed: boolean;
  constructor(message: string, billed: boolean, cause?: unknown) {
    super(message, { cause });
    this.name = "PhotoReadError";
    this.billed = billed;
  }
}

/**
 * What to tell the person when the request brought no answer back. The three
 * cases need different things from them: wait, change the photos, or nothing
 * (it is ours to fix), so "try again in a minute" is only said when trying
 * again can help.
 */
function whyNoAnswer(err: unknown): string {
  const status = err instanceof Anthropic.APIError ? err.status : undefined;
  if (status === 400 || status === 413 || status === 422) return "The photo reading could not take these photos. Try fewer or smaller ones.";
  // 429, 5xx, 529, or no HTTP status at all on an APIError (the connection failed or timed out).
  if (err instanceof Anthropic.APIError && (status === undefined || status === 408 || status === 409 || status === 429 || status >= 500)) return "The photo reading service did not answer. Try again in a minute.";
  // 401/402/403/404, a missing key, or anything unexpected on the way out: nothing the person can do.
  return "The photo reading is not set up correctly on our side. Trying again will not help; this one is ours to fix.";
}

/** By name and shape, not by class identity: the same file can be loaded twice (a bundle and a test runner each load their own copy). */
export function isPhotoReadError(err: unknown): err is PhotoReadError {
  return err instanceof Error && err.name === "PhotoReadError" && typeof (err as PhotoReadError).billed === "boolean";
}

/**
 * The model's answer already matches the schema's shape; this holds its
 * numbers to what they mean. A room's condition is 1 to 5, and a photo number
 * refers to a photo that was sent.
 */
export function tidyAssessment(assessment: PhotoAssessment, photoCount: number): PhotoAssessment {
  return {
    ...assessment,
    rooms: assessment.rooms.map((room) => ({
      ...room,
      condition: Math.min(5, Math.max(1, Math.round(room.condition))),
      photoIndexes: [...new Set(room.photoIndexes)].filter((i) => Number.isInteger(i) && i >= 1 && i <= photoCount),
    })),
  };
}

const SYSTEM = `You are the project manager for an experienced house flipper, assessing listing photos before an offer.
Your job is to say what condition each room is in, what a buyer in this market would want changed, and what is already fine and should be left alone.

Rules:
- Only describe what the photos show. If a category is not visible, mark it "unknown". Never guess a roof or a panel you cannot see.
- Be conservative and specific: "oak cabinets with laminate counters, 1990s" beats "dated kitchen".
- "refresh" means paint, hardware, fixtures, refinishing: cosmetic work brings it to par. "replace" means a full redo is what buyers will price against.
- Flag anything that changes the budget: water stains, cracked foundation, sagging floors, mold, knob-and-tube, fuse boxes, old furnaces.
- List what should be kept. Flippers lose money redoing things that were already fine.
- Use the 1-based photo numbers given before each image.`;

/**
 * Score listing photos with Claude vision. One call, structured output.
 * Caller is responsible for capping photo count and size. Throws
 * PhotoReadError, which says whether an answer was paid for.
 */
export async function analyzePhotos(photos: PhotoInput[], context: PhotoContext = {}): Promise<PhotoReading> {
  if (photos.length === 0) throw new PhotoReadError("No photos to analyze.", false);
  if (photos.length > MAX_PHOTOS) throw new PhotoReadError(`At most ${MAX_PHOTOS} photos per analysis.`, false);

  const content: Anthropic.ContentBlockParam[] = [];
  photos.forEach((p, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}:` });
    content.push({
      type: "image",
      source: "url" in p ? { type: "url", url: p.url } : { type: "base64", media_type: p.mediaType, data: p.base64 },
    });
  });

  const facts = [
    context.address && `Address: ${context.address}`,
    context.sqft && `${context.sqft} sqft`,
    context.beds && `${context.beds} beds`,
    context.baths && `${context.baths} baths`,
    context.yearBuilt && `built ${context.yearBuilt}`,
    context.submarket && `submarket ${context.submarket}`,
  ].filter(Boolean).join(", ");
  content.push({
    type: "text",
    text: `Known facts: ${facts || "none"}.\nAssess these ${photos.length} photos and fill in every field of the assessment.`,
  });

  // create + our own parse, not messages.parse: the two failures must be told apart. An error
  // thrown by the request itself means no answer was generated, so nothing was billed; anything
  // that goes wrong once a response is in hand happens to an answer that was paid for.
  const format = zodOutputFormat(PhotoAssessmentSchema);
  let response: Anthropic.Message;
  try {
    const client = new Anthropic();
    response = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    throw new PhotoReadError(whyNoAnswer(err), false, err);
  }

  if (response.stop_reason === "refusal") {
    throw new PhotoReadError(`Claude declined to assess these photos${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`, true);
  }
  if (response.stop_reason === "max_tokens") throw new PhotoReadError("Assessment was cut off. Try fewer photos.", true);
  const text = response.content.find((block): block is Anthropic.TextBlock => block.type === "text")?.text;
  if (!text) throw new PhotoReadError("Claude returned no structured assessment.", true);
  let assessment: PhotoAssessment;
  try {
    assessment = format.parse(text);
  } catch (err) {
    throw new PhotoReadError("The photo reading came back in a form Renoflip could not use. Try again.", true, err);
  }
  const { usage } = response;
  return {
    assessment: tidyAssessment(assessment, photos.length),
    model: response.model,
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
  };
}
