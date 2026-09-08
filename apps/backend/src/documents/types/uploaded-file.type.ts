/**
 * Minimal multipart file shape used by the documents boundary. Keeping this
 * local avoids coupling the domain service to Multer's ambient type package.
 */
export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}
