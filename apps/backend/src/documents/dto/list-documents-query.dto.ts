import { Confidentiality, DocType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DOCUMENT_STATUSES } from './update-document-status.dto';
import type { DocumentStatus } from './update-document-status.dto';

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsEnum(DocType)
  docType?: DocType;

  @IsOptional()
  @IsEnum(Confidentiality)
  confidentiality?: Confidentiality;

  @IsOptional()
  @IsEnum(DOCUMENT_STATUSES)
  status?: DocumentStatus;
}
