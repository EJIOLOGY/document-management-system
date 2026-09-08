import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ExpiryNotificationType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

const LAGOS_TIME_ZONE = 'Africa/Lagos';

type ExpiryAssessment = {
  daysRemaining: number;
  type: ExpiryNotificationType;
  status: 'EXPIRING_SOON' | 'EXPIRED';
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  // 08:00 Africa/Lagos keeps the date boundary independent of server location.
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { timeZone: LAGOS_TIME_ZONE })
  async runDailyExpiryCheck() {
    const documents = await this.prisma.document.findMany({
      where: { expiryDate: { not: null } },
      select: { id: true, title: true, expiryDate: true },
    });

    for (const document of documents) {
      if (!document.expiryDate) continue;
      const assessment = this.assessExpiry(document.expiryDate);
      if (!assessment) continue;

      try {
        await this.createExpiryEventIfNeeded(document, assessment);
      } catch (error) {
        this.logger.error(
          `Failed to create ${assessment.type} notification for document ${document.id}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  async listForUser(userId: string, unreadOnly = false) {
    return this.prisma.inAppNotification.findMany({
      where: { userId, ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        document: { select: { id: true, title: true, expiryDate: true } },
      },
    });
  }

  async getPopupForUser(userId: string) {
    const notifications = await this.listForUser(userId, true);
    return {
      count: notifications.length,
      notifications,
    };
  }

  async markRead(id: string, userId: string) {
    const notification = await this.prisma.inAppNotification.findFirst({
      where: { id, userId },
    });
    if (!notification) throw new NotFoundException('Notification not found');

    if (notification.read) return notification;

    return this.prisma.inAppNotification.update({
      where: { id },
      data: { read: true, readAt: new Date() },
    });
  }

  async getOutstandingExpiryItems(userId: string) {
    const documents = await this.prisma.document.findMany({
      where: { expiryDate: { not: null } },
      select: { id: true, title: true, expiryDate: true },
    });

    const assessed = documents.flatMap((document) => {
      if (!document.expiryDate) return [];
      const assessment = this.assessExpiry(document.expiryDate);
      return assessment ? [{ document, assessment }] : [];
    });

    if (!assessed.length) return [];

    const notifications = await this.prisma.inAppNotification.findMany({
      where: {
        userId,
        OR: assessed.map(({ document, assessment }) => ({
          documentId: document.id,
          type: assessment.type,
        })),
      },
      select: { id: true, documentId: true, type: true, read: true },
    });
    const notificationByEvent = new Map(
      notifications.map((notification) => [
        `${notification.documentId}:${notification.type}`,
        notification,
      ]),
    );

    return assessed.map(({ document, assessment }) => {
      const notification = notificationByEvent.get(
        `${document.id}:${assessment.type}`,
      );
      return {
        documentId: document.id,
        title: document.title,
        expiryDate: this.toLagosDateString(document.expiryDate!),
        daysRemaining: assessment.daysRemaining,
        status: assessment.status,
        notificationType: assessment.type,
        notificationId: notification?.id ?? null,
        read: notification?.read ?? null,
      };
    });
  }

  private async createExpiryEventIfNeeded(
    document: { id: string; title: string; expiryDate: Date | null },
    assessment: ExpiryAssessment,
  ) {
    const existing = await this.prisma.notificationSent.findUnique({
      where: {
        documentId_type: { documentId: document.id, type: assessment.type },
      },
    });
    if (existing) return;

    const recipients = await this.prisma.user.findMany({
      where: {
        active: true,
        role: { in: [Role.BIDDING_OFFICER, Role.HEAD_OF_BIDDING] },
      },
      select: { id: true, email: true },
    });
    const content = this.notificationContent(document, assessment);

    await Promise.all(
      recipients.map((recipient) =>
        this.emailService.sendExpiryNotification(
          recipient.email,
          content.title,
          content.message,
        ),
      ),
    );

    await this.prisma.$transaction([
      this.prisma.notificationSent.create({
        data: { documentId: document.id, type: assessment.type },
      }),
      this.prisma.inAppNotification.createMany({
        data: recipients.map((recipient) => ({
          userId: recipient.id,
          documentId: document.id,
          type: assessment.type,
          title: content.title,
          message: content.message,
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  private assessExpiry(expiryDate: Date, now = new Date()): ExpiryAssessment | null {
    const daysRemaining = this.calendarDayDifference(expiryDate, now);

    if (daysRemaining < 0) {
      return { daysRemaining, type: ExpiryNotificationType.EXPIRED, status: 'EXPIRED' };
    }
    if (daysRemaining <= 7) {
      return {
        daysRemaining,
        type: ExpiryNotificationType.EXPIRING_7_DAYS,
        status: 'EXPIRING_SOON',
      };
    }
    if (daysRemaining <= 30) {
      return {
        daysRemaining,
        type: ExpiryNotificationType.EXPIRING_30_DAYS,
        status: 'EXPIRING_SOON',
      };
    }
    return null;
  }

  private notificationContent(
    document: { title: string; expiryDate: Date | null },
    assessment: ExpiryAssessment,
  ) {
    const expiryDate = this.formatLagosDate(document.expiryDate!);
    if (assessment.type === ExpiryNotificationType.EXPIRED) {
      return {
        title: 'Document expired',
        message: `${document.title} expired on ${expiryDate}.`,
      };
    }

    const dayLabel = assessment.daysRemaining === 1 ? 'day' : 'days';
    return {
      title:
        assessment.type === ExpiryNotificationType.EXPIRING_7_DAYS
          ? 'Document expires soon'
          : 'Document expiring soon',
      message: `${document.title} expires in ${assessment.daysRemaining} ${dayLabel} on ${expiryDate}.`,
    };
  }

  private calendarDayDifference(expiryDate: Date, now: Date) {
    const expiry = this.lagosCalendarDate(expiryDate);
    const today = this.lagosCalendarDate(now);
    return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
  }

  private lagosCalendarDate(value: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LAGOS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  }

  private toLagosDateString(value: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: LAGOS_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private formatLagosDate(value: Date) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: LAGOS_TIME_ZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(value);
  }
}
