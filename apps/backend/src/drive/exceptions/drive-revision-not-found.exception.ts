import { NotFoundException } from '@nestjs/common';

/**
 * Thrown when a specific Drive revision can no longer be retrieved.
 *
 * This is expected, not a bug: per the locked version-retention decision
 * (see PROJECT-SPEC-MASTER.md §5), `keepRevisionForever` is deliberately
 * NOT set on uploads. Google Drive keeps the current (head) revision of a
 * file forever, but older, superseded revisions are purgeable and are
 * typically auto-deleted by Drive after ~30 days.
 *
 * The `document_versions` row in Postgres (who uploaded it, when, change
 * note) is permanent regardless — only the underlying Drive file *content*
 * for that old revision ages out. When this happens, the UI should show
 * something like "this version's file is no longer retrievable (past
 * 30-day retention); metadata below" rather than a generic error.
 */
export class DriveRevisionNotFoundException extends NotFoundException {
  constructor(driveFileId: string, revisionId?: string) {
    super(
      revisionId
        ? `Drive revision ${revisionId} for file ${driveFileId} is no longer retrievable (likely aged out of retention).`
        : `Drive file ${driveFileId} could not be found.`,
    );
  }
}
