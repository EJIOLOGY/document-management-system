import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';

// Per spec Section 4: "Manage users" is Head of Bidding only.
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('pending')
  @Roles(Role.HEAD_OF_BIDDING)
  findPending() {
    return this.usersService.findPending();
  }

  @Patch(':id/approve')
  @Roles(Role.HEAD_OF_BIDDING)
  approve(@Param('id') id: string) {
    return this.usersService.approve(id);
  }

  @Patch(':id/deactivate')
  @Roles(Role.HEAD_OF_BIDDING)
  deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }
}
