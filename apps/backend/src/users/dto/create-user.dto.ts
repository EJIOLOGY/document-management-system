import { Role } from '@prisma/client';

export class CreateUserDto {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  active: boolean;
}
