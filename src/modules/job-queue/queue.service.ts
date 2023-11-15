import { Injectable } from '@nestjs/common';
import * as kue from 'kue';

@Injectable()
export class QueueService {
  private queue = kue.createQueue({ /* Kue configuration */ });

  getQueue() {
    return this.queue;
  }

  createJob(jobType: string, jobData: any) {
    console.log('Creating job with data:', jobData);
    const job = this.queue.create(jobType, jobData)
      .removeOnComplete(true)
      .attempts(5) // Number of retries
      .backoff({ delay: 15 * 1000, type: 'fixed' }) // Retry delay
      .save();

      job.on('complete', () => {
        console.log(`Job completed: ${job.id}`);
        // Additional logic for when the job completes successfully
      }).on('failed attempt', (errorMessage, doneAttempts) => {
        console.warn(`Job ${job.id} failed attempt ${doneAttempts} with error: ${errorMessage}`);
        // Logic for handling each failed attempt (e.g., logging or alerting)
      }).on('failed', () => {
        console.error(`Job ${job.id} failed after all retries`);
        // Logic for handling the final job failure (e.g., notifying admins or taking corrective action)
      });
  }
}
