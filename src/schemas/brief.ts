import { z } from 'zod';
import { PriorityFindingSchema } from './priority.js';
import { ClutterSenderGroupSchema } from './clutter.js';
import { ProposedActionSchema } from './action.js';

export const BriefSectionKindSchema = z.enum([
  'needs_reply',
  'money',
  'scheduling',
  'job_career',
  'fyi_important',
  'clutter_cleanup',
]);
export type BriefSectionKind = z.infer<typeof BriefSectionKindSchema>;

export const DailyBriefSectionSchema = z.object({
  kind: BriefSectionKindSchema,
  title: z.string(),
  summary: z.string().max(800),
  items: z.array(PriorityFindingSchema).default([]),
  clutterGroups: z.array(ClutterSenderGroupSchema).default([]),
  proposedActions: z.array(ProposedActionSchema).default([]),
});
export type DailyBriefSection = z.infer<typeof DailyBriefSectionSchema>;

export const DailyBriefSchema = z.object({
  id: z.string(),
  generatedAt: z.string().datetime(),
  headline: z.string().max(280),
  sections: z.array(DailyBriefSectionSchema),
  scanResultIds: z.array(z.string()).default([]),
});
export type DailyBrief = z.infer<typeof DailyBriefSchema>;
