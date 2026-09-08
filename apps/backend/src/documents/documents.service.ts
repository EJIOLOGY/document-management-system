import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Readable } from 'stream';
import { DriveService } from '../drive/drive.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { CreateDocumentVersionDto } from './dto/create-document-version.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentStatus } from './dto/update-document-status.dto';
import type { UploadedFile } from './types/uploaded-file.type';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly driveService: DriveService,
  ) {}

  async create(dto: CreateDocumentDto, file: UploadedFile, userId: string) {
    // Metadata and file validation occur in the controller before this Drive call.
    const uploaded = await this.driveService.uploadNewDocument({
      fileName: file.originalname,
      mimeType: file.mimetype,
      stream: Readable.from(file.buffer),
    });

    try {
      // Nested create is atomic: a Drive upload can never yield a partial
      // Document/DocumentVersion database state.
      return await this.prisma.document.create({
        data: {
          title: dto.title,
          category: dto.category,
          docType: dto.docType,
          confidentiality: dto.confidentiality,
          issueDate: this.toDate(dto.issueDate),
          expiryDate: this.toDate(dto.expiryDate),
          reviewDate: this.toDate(dto.reviewDate),
          ownerId: userId,
          versions: {
            create: {
              driveFileId: uploaded.driveFileId,
              driveRevisionId: uploaded.driveRevisionId,
              versionNumber: 1,
              uploadedById: userId,
            },
          },
        },
        include: { versions: true },
      });
    } catch (error) {
      // Compensate for a failed metadata write without persisting a file locally.
      await this.driveService.softDelete(uploaded.driveFileId).catch(() => undefined);
      throw error;
    }
  }

  async addVersion(
    documentId: string,
    dto: CreateDocumentVersionDto,
    file: UploadedFile,
    userId: string,
  ) {
    const document = await this.findDocument(documentId);
    const currentVersion = await this.prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
    });

    if (!currentVersion) {
      throw new NotFoundException('Document has no current version');
    }

    const uploaded = await this.driveService.uploadNewVersion({
      driveFileId: currentVersion.driveFileId,
      stream: Readable.from(file.buffer),
    });

    const nextVersionNumber = currentVersion.versionNumber + 1;
    // A Document is the stable record for all of its versions. Therefore a
    // version upload preserves the parent record and makes it active again;
    // superseded state belongs to a replaced document, not a historical row.
    const [, version] = await this.prisma.$transaction([
      this.prisma.document.update({
        where: { id: document.id },
        data: { status: 'active' },
      }),
      this.prisma.documentVersion.create({
        data: {
          documentId,
          driveFileId: currentVersion.driveFileId,
          driveRevisionId: uploaded.driveRevisionId,
          versionNumber: nextVersionNumber,
          uploadedById: userId,
          changeNote: dto.changeNote,
        },
      }),
    ]);

    return version;
  }

  async findAll(query: ListDocumentsQueryDto) {
    const where: Prisma.DocumentWhereInput = {
      ...(query.category
        ? { category: { equals: query.category, mode: 'insensitive' } }
        : {}),
      ...(query.docType ? { docType: query.docType } : {}),
      ...(query.confidentiality ? { confidentiality: query.confidentiality } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: 'insensitive' } },
              { category: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return this.prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { versions: true } },
      },
    });
  }

  async findOne(id: string) {
    return this.findDocument(id, {
      owner: { select: { id: true, name: true, email: true } },
      tags: { include: { tag: true } },
      versions: {
        orderBy: { versionNumber: 'desc' },
        select: {
          id: true,
          versionNumber: true,
          uploadedAt: true,
          changeNote: true,
          uploadedBy: { select: { id: true, name: true, email: true } },
        },
      },
    });
  }

  async updateMetadata(id: string, dto: UpdateDocumentDto) {
    await this.findDocument(id);
    return this.prisma.document.update({
      where: { id },
      data: {
        ...dto,
        issueDate: this.toDate(dto.issueDate),
        expiryDate: this.toDate(dto.expiryDate),
        reviewDate: this.toDate(dto.reviewDate),
      },
    });
  }

  async updateStatus(id: string, status: DocumentStatus) {
    await this.findDocument(id);
    return this.prisma.document.update({ where: { id }, data: { status } });
  }

  async getVersionHistory(documentId: string) {
    await this.findDocument(documentId);
    return this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        driveRevisionId: true,
        uploadedAt: true,
        changeNote: true,
        uploadedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async getDownload(documentId: string, versionNumber?: number) {
    const document = await this.findDocument(documentId);
    const version = await this.prisma.documentVersion.findFirst({
      where: versionNumber ? { documentId, versionNumber } : { documentId },
      orderBy: { versionNumber: 'desc' },
    });

    if (!version) {
      throw new NotFoundException('Document version not found');
    }

    return {
      stream: await this.driveService.getDownloadStream(
        version.driveFileId,
        versionNumber ? (version.driveRevisionId ?? undefined) : undefined,
      ),
      fileName: `${this.safeFileName(document.title)}-v${version.versionNumber}`,
    };
  }

  private async findDocument<T extends Prisma.DocumentInclude | undefined = undefined>(
    id: string,
    include?: T,
  ) {
    const document = await this.prisma.document.findUnique({ where: { id }, include });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  private toDate(value?: string) {
    return value ? new Date(value) : undefined;
  }

  private safeFileName(title: string) {
    return title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'document';
  }
}
