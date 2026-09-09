import { IsIn, IsString } from 'class-validator';

// The Prisma schema intentionally keeps status as a string. These are the
// lifecycle values used by the current documents workflow.
export const DOCUMENT_STATUSES = ['draft', 'active', 'superseded'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export class UpdateDocumentStatusDto {
  @IsString()
  @IsIn(DOCUMENT_STATUSES)
  status: DocumentStatus;
}
