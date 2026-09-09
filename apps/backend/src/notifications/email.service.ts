import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter?: Transporter;
  private readonly from?: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const from = process.env.SMTP_FROM;

    if (!host || !from) {
      this.logger.warn(
        'SMTP is not configured; expiry emails will not be delivered until SMTP_HOST and SMTP_FROM are set.',
      );
      return;
    }

    this.from = from;
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASSWORD
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
    });
  }

  async sendExpiryNotification(to: string, subject: string, message: string) {
    if (!this.transporter || !this.from) return;

    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text: message,
    });
  }
}
