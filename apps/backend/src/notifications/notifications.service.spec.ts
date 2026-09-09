import { ExpiryNotificationType } from '@prisma/client';
import { EmailService } from './email.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const prisma = {
    document: { findMany: jest.fn() },
    notificationSent: { findUnique: jest.fn(), create: jest.fn() },
    user: { findMany: jest.fn() },
    inAppNotification: { createMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const email = { sendExpiryNotification: jest.fn() };
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(prisma as never, email as EmailService);
  });

  it('uses Africa/Lagos calendar dates and does not treat today as expired', () => {
    const assess = (service as any).assessExpiry.bind(service);
    const now = new Date('2026-09-08T12:00:00.000Z');

    expect(assess(new Date('2026-09-08T00:00:00.000Z'), now)).toMatchObject({
      daysRemaining: 0,
      type: ExpiryNotificationType.EXPIRING_7_DAYS,
    });
    expect(assess(new Date('2026-09-15T00:00:00.000Z'), now)).toMatchObject({
      daysRemaining: 7,
      type: ExpiryNotificationType.EXPIRING_7_DAYS,
    });
    expect(assess(new Date('2026-09-07T00:00:00.000Z'), now)).toMatchObject({
      daysRemaining: -1,
      type: ExpiryNotificationType.EXPIRED,
    });
  });

  it('creates an event once and does not resend an already-recorded state', async () => {
    const assessment = {
      daysRemaining: 10,
      type: ExpiryNotificationType.EXPIRING_30_DAYS,
      status: 'EXPIRING_SOON' as const,
    };
    jest.spyOn(service as any, 'assessExpiry').mockReturnValue(assessment);
    prisma.document.findMany.mockResolvedValue([
      { id: 'document-1', title: 'NUPRC Licence', expiryDate: new Date() },
    ]);
    prisma.notificationSent.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'sent-1' });
    prisma.user.findMany.mockResolvedValue([{ id: 'user-1', email: 'officer@example.com' }]);
    prisma.notificationSent.create.mockReturnValue({});
    prisma.inAppNotification.createMany.mockReturnValue({});
    prisma.$transaction.mockResolvedValue([]);

    await service.runDailyExpiryCheck();
    await service.runDailyExpiryCheck();

    expect(email.sendExpiryNotification).toHaveBeenCalledTimes(1);
    expect(prisma.notificationSent.create).toHaveBeenCalledWith({
      data: { documentId: 'document-1', type: ExpiryNotificationType.EXPIRING_30_DAYS },
    });
    expect(prisma.inAppNotification.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });
});
