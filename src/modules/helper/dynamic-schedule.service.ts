import { Injectable } from '@nestjs/common';
import { CronJob, CronTime } from 'cron';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';

@Injectable()
export class DynamicScheduleService {
  constructor(private schedulerRegistry: SchedulerRegistry) {}

  addDynamicCronJob(name: string, cronTime: string, callback: () => void) {
    const job = new CronJob(cronTime, callback);
    this.schedulerRegistry.addCronJob(name, job);
    job.start();
  }

  updateCronJob(name: string, newCronTime: string) {
    const job = this.schedulerRegistry.getCronJob(name);
    job.setTime(new CronTime(newCronTime));
    job.start();
  }

  removeCronJob(name: string) {
    this.schedulerRegistry.deleteCronJob(name);
  }

  adjustJobSchedule(jobname: string, pendingCount: number) {
    let cronTime = '*/10 * * * * *';

    if (pendingCount > 50) {
      cronTime = '*/5 * * * * *'; // Every 5 seconds
    } else if (pendingCount > 10) {
      cronTime = '*/15 * * * * *'; // Every 15 seconds
    } else {
      cronTime = '0 * * * * *'; // Every minute
    }
    // Update the job dynamically
    this.updateCronJob(jobname, cronTime);
  }
}
