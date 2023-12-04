// import { Job } from 'kue';
import { GraphQLClient } from 'graphql-request';
import {
  GetCollections1155QueryVariables,
  GetCollections721QueryVariables,
  getSdk,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { TX_STATUS } from '@prisma/client';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_NAME_COLLECTION } from 'src/constants/Job.constant';

interface SyncCollection {
  txCreation: string;
  type: 'ERC721' | 'ERC1155';
}

@Processor(QUEUE_NAME_COLLECTION)
export class CollectionsCheckProcessor {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(private readonly prisma: PrismaService) {}

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }
  @Process('collection-create')
  private async checkCollectionStatus(
    job: Job<SyncCollection>,
  ): Promise<boolean> {
    const { txCreation, type } = job.data;
    const client = this.getGraphqlClient();
    let isExisted = false;
    const sdk = getSdk(client);
    console.log('let see: ', txCreation);
    if (type === 'ERC721') {
      const variables: GetCollections721QueryVariables = {
        txCreation: txCreation,
      };
      try {
        const response = await sdk.GetCollections721(variables);
        console.log(response);
        if (response.erc721Contracts.length > 0) {
          await this.prisma.collection.update({
            where: {
              txCreationHash: txCreation,
            },
            data: {
              status: TX_STATUS.SUCCESS,
              address: response.erc721Contracts[0].id,
            },
          });
          isExisted = true;
        }
        return isExisted;
      } catch (err) {
        console.log(err);
      }
    } else {
      const variables: GetCollections1155QueryVariables = {
        txCreation: txCreation,
      };
      try {
        const response = await sdk.GetCollections1155(variables);
        console.log(response);
        if (response.erc1155Contracts.length > 0) {
          await this.prisma.collection.update({
            where: {
              txCreationHash: txCreation,
            },
            data: {
              status: TX_STATUS.SUCCESS,
              address: response.erc1155Contracts[0].id,
            },
          });
          isExisted = true;
        }
        return isExisted;
      } catch (err) {
        console.log(err);
      }
    }
  }
}
