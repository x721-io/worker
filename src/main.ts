import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as compression from 'compression';
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
// import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { CollectionsUtilsProcessor } from './modules/job-queue/collection-utils.processor';
// import { GraphQLErrorFilter } from './commons/errors/ExceptionFilter';
function matchRegexArray(arr: string[], str: string): boolean {
  for (const pattern of arr) {
    const regex = new RegExp(pattern);
    if (regex.test(str)) {
      return true;
    }
  }
  return false;
}
export let collectionsUtils: CollectionsUtilsProcessor = null;

const whitelist = ['http://localhost:3000'];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  app.enableCors({
    origin: function (origin, callback) {
      if (!origin || matchRegexArray(whitelist, origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  });
  if (process.env.SYNC_METRIC_POINT === 'true') {
    collectionsUtils = app.get(CollectionsUtilsProcessor);
    collectionsUtils.handleSyncMetricPoint();
  }

  app.use(compression());
  await app.listen(7777);
}
bootstrap();
