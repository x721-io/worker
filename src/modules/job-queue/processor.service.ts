import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';

@Processor('collections-check')
export class CollectionsCheckProcessor {
  @Process()
  async checkCollectionStatus(job: Job<any>) {
    // Logic to check collection status on Subgraph
    // Update the backend if the collection is created
  }
}
