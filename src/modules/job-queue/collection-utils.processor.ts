// import { Job } from 'kue';
import { GraphQLClient } from 'graphql-request';
import {
  GetNfTsSelling1155QueryVariables,
  GetNfTsSelling721QueryVariables,
  getSdk,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { QUEUE_COLLECTION_UTILS } from 'src/constants/Job.constant';
import { Cron, CronExpression } from '@nestjs/schedule';
import { logger } from 'src/commons';
import { OnModuleInit } from '@nestjs/common';
import OtherCommon from 'src/commons/Other.common';
import MetricCommon from 'src/commons/Metric.common';
import { MetricCategory, TypeCategory } from 'src/constants/enums/Metric.enum';
interface FloorPriceProcess {
  address: string;
}

@Processor(QUEUE_COLLECTION_UTILS)
export class CollectionsUtilsProcessor implements OnModuleInit {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(private readonly prisma: PrismaService) {}

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }

  @Process('update-floor-price')
  private async updateFloorPrice(job: Job<FloorPriceProcess>) {
    console.log(job.data);
    await OtherCommon.delay(5000);
    await this.handleUpdateFloorPrice(job.data.address);
  }

  async onModuleInit() {
    logger.info(`call First time: QUEUE_COLLECTION_UTILS `);
    await Promise.all([
      this.handleSyncMetricPoint(),
      this.handleSyncFloorPrice(),
    ]);
    // await this.handleSyncFloorPrice(); // Run the task once immediately upon service start
  }

  async handleSyncMetricPoint() {
    try {
      const listCollection = await this.prisma.collection.findMany({
        where: {
          NOT: {
            address: {
              in: [process.env.BASE_ADDR_1155, process.env.BASE_ADDR_721],
            },
          },
        },
      });
      await Promise.all(
        listCollection.map(async (item) => {
          if (item.address) {
            await MetricCommon.handleMetric(
              TypeCategory.Collection,
              MetricCategory.CollectionMetric,
              item.id,
            );
          }
        }),
      );
      logger.info(`Sync Data Metric Collection Successfully`);
    } catch (error) {
      logger.error(`Sync Data Floor Price: ${JSON.stringify(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_2_HOURS)
  async handleSyncFloorPrice() {
    try {
      const listCollection = await this.prisma.collection.findMany();
      await Promise.all(
        listCollection.map(async (item) => {
          await this.handleUpdateFloorPrice(item.address);
        }),
      );
      logger.info(`Sync Data Floor Price All Collection Successfully`);
      // collection
    } catch (error) {
      logger.error(`Sync Data Floor Price: ${JSON.stringify(error)}`);
    }
  }

  async handleUpdateFloorPrice(address: string) {
    const collection = await this.prisma.collection.findUnique({
      where: {
        address,
      },
    });
    if (!collection) {
      console.error('Collection not found');
      return;
    }
    // for (let i = 0; i < collections.length; i++) {
    let skip = 0;
    let hasMore = true;
    let floorPrice = BigInt(0);
    const first = 1000;
    const client = this.getGraphqlClient();
    const sdk = getSdk(client);
    if (collection.type === 'ERC721') {
      while (hasMore) {
        const variables: GetNfTsSelling721QueryVariables = {
          first,
          skip,
          collection: collection.address,
        };
        const response = await sdk.GetNFTsSelling721(variables);
        if (response.marketEvent721S.length > 0) {
          for (let i = 0; i < response.marketEvent721S.length; i++) {
            if (floorPrice === BigInt(0)) {
              floorPrice = response.marketEvent721S[i].price;
            } else {
              if (
                BigInt(response.marketEvent721S[i].price) < BigInt(floorPrice)
              ) {
                floorPrice = response.marketEvent721S[i].price;
              }
            }
          }
          skip += first;
        } else {
          hasMore = false;
        }
      }
    }
    if (collection.type === 'ERC1155') {
      while (hasMore) {
        const variables: GetNfTsSelling1155QueryVariables = {
          first,
          skip,
          collection: collection.address,
        };
        const response = await sdk.GetNFTsSelling1155(variables);
        if (response.marketEvent1155S.length > 0) {
          for (let i = 0; i < response.marketEvent1155S.length; i++) {
            if (floorPrice === BigInt(0)) {
              floorPrice = response.marketEvent1155S[i].price;
            } else {
              if (
                BigInt(response.marketEvent1155S[i].price) < BigInt(floorPrice)
              ) {
                floorPrice = response.marketEvent1155S[i].price;
              }
            }
          }
          skip += first;
        } else {
          hasMore = false;
        }
      }
    }
    await this.prisma.collection.update({
      where: {
        address,
      },
      data: {
        floorPrice: BigInt(floorPrice) / BigInt(10 ** 18),
      },
    });
    return true;
  }
}
