import { Module } from '@nestjs/common';
import { ScheduleModule as CronModule } from '@nestjs/schedule';
import { PrismaService } from './prisma/prisma.service';
import { ApiCallerModule } from './modules/api-caller/api-caller.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { WebhookModule } from './modules/webhook/webhook.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CommonModule } from './modules/common/common.module';
import { GraphQlcallerModule } from './modules/graph-qlcaller/graph-qlcaller.module';
import { JobQueueModule } from './modules/job-queue/job-queue.module';
import { NftCrawlerModule } from './modules/nft-crawler/nft-crawler.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
// import { HandlebarsAdapter, MailerModule } from '@nest-modules/mailer';
import { join } from 'path';
@Module({
  imports: [
    // ConfigModule.forRoot({
    //   ignoreEnvFile: true,
    // }),
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({
      ttl: 60,
      limit: 80,
    }),
    CronModule.forRoot(),
    ApiCallerModule,
    WebhookModule,
    CommonModule,
    GraphQlcallerModule,
    JobQueueModule,
    NftCrawlerModule,
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (config: ConfigService) => ({
        transport: {
          host: config.get('MAIL_HOST'),
          secure: false,
          auth: {
            user: config.get('MAIL_USER'),
            pass: config.get('MAIL_PASSWORD'),
          },
        },
        defaults: {
          from: `"No Reply" <${config.get('MAIL_FROM')}>`,
        },
        template: {
          dir: join(__dirname, 'templates/email'),
          adapter: new HandlebarsAdapter(),
          options: {
            strict: true,
          },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [PrismaService],
})
export class AppModule {
  constructor() {}
}
