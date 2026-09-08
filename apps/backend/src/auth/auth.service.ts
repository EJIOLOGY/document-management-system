import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Role, User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const SALT_ROUNDS = 12;
const REFRESH_TOKEN_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

@Injectable()
export class AuthService {
  private refreshJwtService: JwtService;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    if (!refreshSecret) {
      throw new Error('JWT_REFRESH_SECRET is not set — check .env');
    }
    this.refreshJwtService = new JwtService({
      secret: refreshSecret,
      signOptions: { expiresIn: '3d' },
    });
  }

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      role: Role.BIDDING_OFFICER,
      active: false,
    });

    return {
      message:
        'Registration received. An administrator must approve your account before you can log in.',
      userId: user.id,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account is pending approval');
    }

    return this.issueTokenPair(user);
  }

  /**
   * Rotation: presenting a valid refresh token invalidates it and issues
   * a new pair — only one valid refresh token per user at a time.
   * Reuse detection: a signature-valid token that doesn't match what's
   * stored (already rotated, or stolen) gets the account's token revoked
   * outright, forcing re-login.
   */
  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = this.refreshJwtService.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.active || !user.refreshTokenHash) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt < new Date()) {
      await this.usersService.clearRefreshToken(user.id);
      throw new UnauthorizedException('Refresh token expired');
    }

    const matches = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!matches) {
      await this.usersService.clearRefreshToken(user.id);
      throw new UnauthorizedException(
        'Refresh token reuse detected — please log in again',
      );
    }

    return this.issueTokenPair(user);
  }

  async logout(userId: string) {
    await this.usersService.clearRefreshToken(userId);
    return { message: 'Logged out' };
  }

  private async issueTokenPair(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.refreshJwtService.sign({ sub: user.id });

    const refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
    const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

    await this.usersService.setRefreshToken(
      user.id,
      refreshTokenHash,
      refreshTokenExpiresAt,
    );

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }
}
