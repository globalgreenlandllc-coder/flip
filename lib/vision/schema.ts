import { z } from "zod";

/** What Claude returns after looking at the listing photos. */

export const NeedSchema = z.enum(["none", "refresh", "replace", "unknown"]);

export const RoomSchema = z.object({
  room: z.enum(["kitchen", "bathroom", "living", "dining", "bedroom", "basement", "exterior", "garage", "laundry", "other"]),
  label: z.string().describe("Short name, e.g. 'Primary bath' or 'Front exterior'"),
  condition: z.number().int().describe("1 = gut it, 2 = heavily dated, 3 = dated but functional, 4 = updated, 5 = recently renovated"),
  finishLevel: z.enum(["dated", "builder", "mid", "high"]),
  issues: z.array(z.string()).describe("Visible defects or dated elements that a buyer would notice"),
  keep: z.array(z.string()).describe("Elements already at par that should NOT be redone"),
  photoIndexes: z.array(z.number().int()).describe("1-based indexes of the photos showing this room"),
});

export const CategoryNeedsSchema = z.object({
  kitchen: NeedSchema,
  baths: NeedSchema,
  flooring: NeedSchema,
  paint: NeedSchema,
  exterior: NeedSchema,
  landscaping: NeedSchema,
  windows: NeedSchema,
  roof: NeedSchema,
  electrical: NeedSchema,
  plumbing: NeedSchema,
  hvac: NeedSchema,
  basement: NeedSchema,
});

export const PhotoAssessmentSchema = z.object({
  overallCondition: z.enum(["distressed", "dated", "average", "updated", "renovated"]),
  summary: z.string().describe("Two or three sentences a flipper would say after flipping through these photos"),
  rooms: z.array(RoomSchema),
  categoryNeeds: CategoryNeedsSchema.describe("Per category: none = at par, refresh = cosmetic work brings it to par, replace = full redo, unknown = not visible"),
  redFlags: z.array(z.string()).describe("Water stains, cracks, mold, sagging, knob-and-tube, old panel, anything that changes the budget"),
  unknowns: z.array(z.string()).describe("Things the photos cannot show that must be checked on site"),
});

export type PhotoAssessment = z.infer<typeof PhotoAssessmentSchema>;
