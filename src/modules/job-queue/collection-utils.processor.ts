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
import { CONTRACT_TYPE, Prisma, TX_STATUS } from '@prisma/client';
import subgraphServiceCommon from '../helper/subgraph-helper.service';
interface FloorPriceProcess {
  address: string;
}

interface itemSubgraph {
  tokenURI: string;
  tokenID: string;
  id: string;
  balance?: string;
  createdAt: string;
}

interface listItemSubgraph {
  items?: itemSubgraph[];
}

interface responseIPFS {
  image?: string;
  image_url?: string;
  name?: string;
  fileUrls?: any[];
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
    await Promise.allSettled([
      // this.handleSyncMetricPoint(),
      this.handleSyncFloorPrice(),
    ]);
  }

  async handleSyncMetricPoint() {
    try {
      const batchSize = 100;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const listCollection = await this.prisma.collection.findMany({
          where: {
            NOT: {
              address: {
                in: [process.env.BASE_ADDR_1155, process.env.BASE_ADDR_721],
              },
            },
            address: {
              not: null,
            },
          },
          take: batchSize,
          skip: offset,
        });

        if (listCollection?.length > 0) {
          await Promise.allSettled(
            listCollection.map(async (item) => {
              await MetricCommon.handleMetric(
                TypeCategory.Collection,
                MetricCategory.CollectionMetric,
                item.id,
              );
            }),
          );
          offset += batchSize;
        } else {
          hasMore = false;
        }
      }
      logger.info(`Sync Data Metric Collection Successfully`);
    } catch (error) {
      logger.error(
        `Sync Data Metric Collection Successfully: ${JSON.stringify(error)}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handleSyncCollectionExtend() {
    try {
      const collectionExtend = await this.getCollectionsToExtend();
      const getIsSync = await this.checkIsSync();

      if (getIsSync) {
        logger.info('Sync data extend collections is already running');
        await this.handleSetCollectionExternal();
        return;
      }
      for (const collection of collectionExtend) {
        await this.prisma.collection.update({
          where: {
            id: collection.id,
          },
          data: {
            isSync: true,
          },
        });
        let skip = 0;
        const first = 1000;
        let hasMore = true;
        let lastProcessedTimestamp = 0;
        while (hasMore) {
          const resultSubgraphQuery: listItemSubgraph =
            await subgraphServiceCommon.subgraphQuery(
              collection.subgraphUrl,
              collection.type,
              skip,
              first,
              collection?.lastTimeSync,
            );
          if (resultSubgraphQuery?.items?.length > 0) {
            for (const item of resultSubgraphQuery?.items) {
              const checkExist = await this.prisma.nFT.findUnique({
                where: {
                  id_collectionId: {
                    collectionId: collection.id,
                    id: item.tokenID,
                  },
                },
              });
              if (!checkExist) {
                if (subgraphServiceCommon.isLink(item.tokenURI)) {
                  const resultIPFS: responseIPFS =
                    await subgraphServiceCommon.getDetailFromIPFS(
                      item.tokenURI,
                    );
                  const ipfsPath = resultIPFS.image ?? resultIPFS.image_url;
                  const name = resultIPFS.name ?? item.tokenID;
                  const creatorId =
                    collection.creators &&
                    collection.creators[0] &&
                    collection.creators[0]?.userId;

                  await this.upsertNFT(
                    item,
                    collection.id,
                    name,
                    item.tokenURI,
                    ipfsPath,
                    creatorId,
                  );
                  await this.upsertUserNFT(item, collection.id, creatorId);
                }
              }
            }
            (lastProcessedTimestamp = parseInt(
              resultSubgraphQuery.items[resultSubgraphQuery.items.length - 1]
                .createdAt,
            )),
              await this.updateCollectionSyncStatus(
                collection.id,
                lastProcessedTimestamp,
              );
            skip += first;
          } else {
            hasMore = false;
          }
        }
      }
      logger.info(`Sync All Collection Extend Successfully`);
    } catch (error) {
      await this.handleSetCollectionExternal();
      logger.error(`handleSyncCollectionExtend: ${error}`);
    }
  }
  @Cron(CronExpression.EVERY_2_HOURS)
  async handleSyncFloorPrice() {
    try {
      const batchSize = 100;
      let offset = 0;
      let hasMore = true;
      while (hasMore) {
        const listCollection = await this.prisma.collection.findMany({
          where: {
            address: {
              not: null,
            },
          },
          take: batchSize,
          skip: offset,
        });
        if (listCollection?.length > 0) {
          await Promise.allSettled(
            listCollection.map(async (item) => {
              await this.handleUpdateFloorPrice(item.address);
            }),
          );
          // for (const item of listCollection) {
          //   // await this.handleUpdateFloorPrice(item.address);
          // }
          offset += batchSize;
        } else {
          hasMore = false;
        }
      }
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
        floor: parseFloat(`${BigInt(floorPrice) / BigInt(10 ** 18)}`),
        floorWei: floorPrice.toString(),
      },
    });
    return true;
  }

  async checkIsSync(): Promise<boolean> {
    const countIsSync = await this.prisma.collection.count({
      where: {
        AND: [{ flagExtend: true }, { isSync: true }],
      },
    });
    if (countIsSync > 0) {
      return true;
    }
    return false;
  }

  async getCollectionsToExtend() {
    return await this.prisma.collection.findMany({
      where: {
        AND: [{ flagExtend: true }, { isSync: false }],
      },
      include: {
        creators: {
          select: { userId: true },
        },
      },
    });
  }

  async markCollectionAsSyncing(collectionId: string) {
    await this.prisma.collection.update({
      where: { id: collectionId },
      data: { isSync: true },
    });
  }

  async updateCollectionSyncStatus(
    collectionId: string,
    lastProcessedTimestamp: number,
  ) {
    await this.prisma.collection.update({
      data: {
        isSync: false,
        lastTimeSync: lastProcessedTimestamp,
      },
      where: { id: collectionId },
    });
  }

  async upsertUserNFT(item, collectionId, creatorId) {
    await this.prisma.userNFT.upsert({
      create: {
        nftId: item.id,
        collectionId,
        quantity: item.balance ? parseInt(item.balance) : 1,
        userId: creatorId,
      },
      update: {
        quantity: item.balance ? parseInt(item.balance) : 1,
      },
      where: {
        userId_nftId_collectionId: {
          nftId: item.id,
          collectionId,
          userId: creatorId,
        },
      },
    });
  }

  async upsertNFT(item, collectionId, name, tokenUri, ipfsPath, creatorId) {
    await this.prisma.nFT.upsert({
      where: { id_collectionId: { id: item.id, collectionId } },
      create: {
        id: item.id,
        name,
        tokenUri,
        status: TX_STATUS.SUCCESS,
        txCreationHash: '',
        creatorId,
        collectionId,
        image: ipfsPath,
      },
      update: {
        name,
        tokenUri,
        status: TX_STATUS.SUCCESS,
        txCreationHash: '',
        creatorId,
        image: ipfsPath,
      },
    });
  }

  async handleSetCollectionExternal() {
    try {
      await this.prisma.collection.updateMany({
        where: {
          flagExtend: true,
        },
        data: {
          isSync: false,
        },
      });
    } catch (error) {
      logger.error(`handleSyncCollectionExtend: ${error}`);
    }
  }
}
