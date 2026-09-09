import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.BIDDING_OFFICER, Role.HEAD_OF_BIDDING)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(@Req() req: { user: { id: string } }, @Query('unreadOnly') unreadOnly?: string) {
    return this.notificationsService.listForUser(req.user.id, unreadOnly === 'true');
  }

  @Get('popup')
  getPopup(@Req() req: { user: { id: string } }) {
    return this.notificationsService.getPopupForUser(req.user.id);
  }

  @Get('expiry-items')
  getOutstandingExpiryItems(@Req() req: { user: { id: string } }) {
    return this.notificationsService.getOutstandingExpiryItems(req.user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Req() req: { user: { id: string } }) {
    return this.notificationsService.markRead(id, req.user.id);
  }
}
