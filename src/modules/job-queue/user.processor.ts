import {} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { CommonService } from '../common/common.service';
import { QUEUE_NAME_USER } from 'src/constants/Job.constant';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { MailerService } from '@nestjs-modules/mailer';
import * as jwt from 'jsonwebtoken';

@Processor(QUEUE_NAME_USER)
export class UserProcessor {
  constructor(private mailService: MailerService) {}
  private readonly secretKeyConfirm = process.env.MAIL_KEY_CONFIRM;
  @Process('email-verify')
  async verifyEmail(job: Job<any>) {
    try {
      const { email, name, id } = job?.data;
      const verifyToken = this.generateTokenConfirm(email, name, id);
      await this.mailService.sendMail({
        to: email,
        subject: 'Email Verify Account Marketplace',
        template: './email',
        context: {
          link: `${process.env.MAIL_REDIRECT_URL}/user/email-verification?token=${verifyToken}`,
        },
      });
      console.log('Send Mail Success');
      return true;
    } catch (error) {
      console.log('Send Mail Success', error);
      return false;
    }
  }

  generateTokenConfirm(email: string, name: string, id: string): string {
    // Set expiration time to 5 minutes
    const expirationTime = '5m';

    return jwt.sign({ email, name, id }, this.secretKeyConfirm, {
      expiresIn: expirationTime,
    });
  }
}
