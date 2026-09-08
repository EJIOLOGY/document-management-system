import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { Readable } from 'stream';
import * as fs from 'fs';
import { DriveRevisionNotFoundException } from './exceptions/drive-revision-not-found.exception';

interface UploadNewDocumentParams {
  fileName: string;
  mimeType: string;
  stream: Readable;
}

interface UploadNewVersionParams {
  driveFileId: string;
  stream: Readable;
}

/**
 * The ONLY class in this codebase permitted to talk to the Google Drive API.
 * Nothing else should import `googleapis` directly — this isolation is what
 * lets a future migration (e.g. to a Shared Drive on a paid Workspace plan)
 * happen in one place. See PROJECT-SPEC-MASTER.md §5.
 */
@Injectable()
export class DriveService {
  private readonly logger = new Logger(DriveService.name);
  private readonly drive: drive_v3.Drive;
  private readonly folderId: string;

  constructor() {
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!keyPath) {
      throw new Error(
        'GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not set — check .env',
      );
    }
    if (!folderId) {
      throw new Error('GOOGLE_DRIVE_FOLDER_ID is not set — check .env');
    }

    const keyFile = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));

    const auth = new JWT({
      email: keyFile.client_email,
      key: keyFile.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    this.drive = google.drive({ version: 'v3', auth: auth as any });
    this.folderId = folderId;
  }

  /**
   * Creates a brand-new file in the shared folder. Returns the Drive file id
   * (permanent identifier, store this in `documents`/`document_versions`)
   * and the id of the initial revision Drive creates automatically.
   */
  async uploadNewDocument(
    params: UploadNewDocumentParams,
  ): Promise<{ driveFileId: string; driveRevisionId: string }> {
    const { fileName, mimeType, stream } = params;

    try {
      const res = await this.drive.files.create({
        requestBody: {
          name: fileName,
          parents: [this.folderId],
        },
        media: {
          mimeType,
          body: stream, // streamed, never buffered fully in memory
        },
        fields: 'id, headRevisionId',
      });

      const driveFileId = res.data.id;
      const driveRevisionId = res.data.headRevisionId;

      if (!driveFileId || !driveRevisionId) {
        throw new InternalServerErrorException(
          'Drive did not return an id/headRevisionId on upload',
        );
      }

      return { driveFileId, driveRevisionId };
    } catch (err) {
      this.logger.error(
        `uploadNewDocument failed for "${fileName}"`,
        err as Error,
      );
      throw new InternalServerErrorException(
        'Failed to upload document to Drive',
      );
    }
  }

  /**
   * Uploads a new version of an EXISTING file. Calling `files.update` with
   * new media on the same file id is what makes Drive auto-record a new
   * revision — this is the whole mechanism behind version control here.
   * Do NOT create a new file for a new version.
   */
  async uploadNewVersion(
    params: UploadNewVersionParams,
  ): Promise<{ driveRevisionId: string }> {
    const { driveFileId, stream } = params;

    try {
      const res = await this.drive.files.update({
        fileId: driveFileId,
        media: {
          body: stream,
        },
        fields: 'headRevisionId',
      });

      const driveRevisionId = res.data.headRevisionId;
      if (!driveRevisionId) {
        throw new InternalServerErrorException(
          'Drive did not return a headRevisionId on version update',
        );
      }

      return { driveRevisionId };
    } catch (err) {
      this.logger.error(
        `uploadNewVersion failed for file ${driveFileId}`,
        err as Error,
      );
      throw new InternalServerErrorException(
        'Failed to upload new version to Drive',
      );
    }
  }

  /**
   * Streams file content back to the caller. If `revisionId` is provided and
   * that specific old revision has aged out of Drive's retention window
   * (expected behavior — see DriveRevisionNotFoundException), throws a
   * specific, catchable exception instead of a generic 500 so the UI can
   * show a friendly "no longer retrievable" message rather than an error page.
   */
  async getDownloadStream(
    driveFileId: string,
    revisionId?: string,
  ): Promise<Readable> {
    try {
      if (revisionId) {
        const res = await this.drive.revisions.get(
          {
            fileId: driveFileId,
            revisionId,
            alt: 'media',
          },
          { responseType: 'stream' },
        );
        return res.data as unknown as Readable;
      }

      const res = await this.drive.files.get(
        { fileId: driveFileId, alt: 'media' },
        { responseType: 'stream' },
      );
      return res.data as unknown as Readable;
    } catch (err) {
      const status =
        (err as { code?: number; status?: number }).code ??
        (err as { code?: number; status?: number }).status;

      if (status === 404) {
        throw new DriveRevisionNotFoundException(driveFileId, revisionId);
      }

      this.logger.error(
        `getDownloadStream failed for file ${driveFileId}${revisionId ? ` revision ${revisionId}` : ''}`,
        err as Error,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve file from Drive',
      );
    }
  }

  /**
   * Moves a file to Drive's trash (recoverable), NOT a permanent delete.
   * Permanent purge, if ever needed, should be a separate, more deliberate
   * HoB-only capability — not this method.
   */
  async softDelete(driveFileId: string): Promise<void> {
    try {
      await this.drive.files.update({
        fileId: driveFileId,
        requestBody: { trashed: true },
      });
    } catch (err) {
      this.logger.error(
        `softDelete failed for file ${driveFileId}`,
        err as Error,
      );
      throw new InternalServerErrorException('Failed to delete file in Drive');
    }
  }
}
