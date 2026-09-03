import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PhotoAssessmentSchema, type PhotoAssessment } from "./schema";

export type PhotoMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
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
 * Caller is responsible for capping photo count and size.
 */
export async function analyzePhotos(photos: PhotoInput[], context: PhotoContext = {}): Promise<PhotoAssessment> {
  if (photos.length === 0) throw new Error("No photos to analyze.");
  if (photos.length > MAX_PHOTOS) throw new Error(`At most ${MAX_PHOTOS} photos per analysis.`);

  const client = new Anthropic();
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

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: zodOutputFormat(PhotoAssessmentSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to assess these photos${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Assessment was cut off. Try fewer photos.");
  if (!response.parsed_output) throw new Error("Claude returned no structured assessment.");
  return response.parsed_output;
}
