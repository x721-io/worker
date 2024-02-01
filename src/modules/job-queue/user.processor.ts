import {} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { CommonService } from '../common/common.service';
import { QUEUE_NAME_USER } from 'src/constants/Job.constant';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { MailerService } from '@nestjs-modules/mailer';
import * as jwt from 'jsonwebtoken';
import { logger } from 'src/commons';

@Processor(QUEUE_NAME_USER)
export class UserProcessor {
  constructor(private mailService: MailerService) {}
  private readonly secretKeyConfirm = process.env.MAIL_KEY_CONFIRM;
  @Process('email-verify')
  async verifyEmail(job: Job<any>) {
    try {
      logger.error(`Send Mail Success: ${JSON.stringify(job?.data)}`);
      const { email, verifyToken } = job?.data;
      await this.mailService.sendMail({
        to: email,
        subject: 'Email Verify Account Marketplace',
        template: './email',
        context: {
          link: `${process.env.MAIL_REDIRECT_URL}/user/email-verification?token=${verifyToken}`,
        },
      });
      logger.info(`Send Mail Success: ${email}: ${JSON.stringify(job?.data)}`);
      return true;
    } catch (error) {
      logger.error(`Send Mail Failed: ${JSON.stringify(error)}`);
      return false;
    }
  }
}
