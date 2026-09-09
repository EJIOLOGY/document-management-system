import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateDocumentVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}
