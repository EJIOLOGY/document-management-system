import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DriveService } from './../src/drive/drive.service';
import { PrismaService } from './../src/prisma/prisma.service';
import { UsersService } from './../src/users/users.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const prisma = {
    document: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const users = {
    findById: jest.fn().mockResolvedValue({
      id: 'bidding-officer-id',
      email: 'officer@example.com',
      role: Role.BIDDING_OFFICER,
      active: true,
    }),
  };
  const drive = {};

  const accessToken = new JwtService({ secret: process.env.JWT_SECRET }).sign({
    sub: 'bidding-officer-id',
    email: 'officer@example.com',
    role: Role.BIDDING_OFFICER,
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(UsersService)
      .useValue(users)
      .overrideProvider(DriveService)
      .useValue(drive)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/documents (GET) requires a JWT', () => {
    return request(app.getHttpServer()).get('/documents').expect(401);
  });

  it('/documents (GET) allows a Bidding Officer to list all documents', () => {
    return request(app.getHttpServer())
      .get('/documents')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect([]);
  });

  afterEach(async () => {
    await app?.close();
  });
});
