import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateDocumentDto } from './dto/create-document.dto';
import { CreateDocumentVersionDto } from './dto/create-document-version.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { UpdateDocumentStatusDto } from './dto/update-document-status.dto';
import { DocumentsService } from './documents.service';
import type { UploadedFile as UploadedDocumentFile } from './types/uploaded-file.type';

const ALLOWED_FILE_TYPES = /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-(excel|powerpoint))|text\/(plain|csv)|image\/(jpeg|png))$/;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BIDDING_OFFICER, Role.HEAD_OF_BIDDING)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  create(
    @Body() dto: CreateDocumentDto,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Req() req: { user: { id: string } },
  ) {
    this.validateFile(file);
    return this.documentsService.create(dto, file, req.user.id);
  }

  @Get()
  findAll(@Query() query: ListDocumentsQueryDto) {
    return this.documentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  @Patch(':id')
  updateMetadata(@Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.documentsService.updateMetadata(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateDocumentStatusDto) {
    return this.documentsService.updateStatus(id, dto.status);
  }

  @Post(':id/versions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE_BYTES } }))
  addVersion(
    @Param('id') id: string,
    @Body() dto: CreateDocumentVersionDto,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Req() req: { user: { id: string } },
  ) {
    this.validateFile(file);
    return this.documentsService.addVersion(id, dto, file, req.user.id);
  }

  @Get(':id/versions')
  getVersionHistory(@Param('id') id: string) {
    return this.documentsService.getVersionHistory(id);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query('version') version: string | undefined,
    @Res() response: Response,
  ) {
    const versionNumber = version
      ? await new ParseIntPipe().transform(version, { type: 'query' })
      : undefined;
    const download = await this.documentsService.getDownload(id, versionNumber);
    response.setHeader('Content-Type', download.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${download.fileName}"`);
    download.stream.pipe(response);
  }

  private validateFile(
    file: UploadedDocumentFile | undefined,
  ): asserts file is UploadedDocumentFile {
    if (!file) {
      throw new BadRequestException('A file is required');
    }
    if (!ALLOWED_FILE_TYPES.test(file.mimetype)) {
      throw new BadRequestException('Unsupported file type');
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File must be between 1 byte and 20 MB');
    }
  }
}
