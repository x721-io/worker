import { GraphQLClient } from 'graphql-request';
import { OrderDirection, getSdk } from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { QUEUE_NAME_MARKETPLACE_STATUS } from 'src/constants/Job.constant';
import { Processor } from '@nestjs/bull';
import { OnModuleInit } from '@nestjs/common';
import { logger } from 'src/commons';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CONTRACT_TYPE,
  SELL_STATUS,
  Prisma,
  SYNCDATASTATUS,
  ORDERSTATUS,
} from '@prisma/client';
import MetricCommon from 'src/commons/Metric.common';
import { MetricCategory, TypeCategory } from 'src/constants/enums/Metric.enum';
@Processor(QUEUE_NAME_MARKETPLACE_STATUS)
export class MarketplaceStatusProcessor implements OnModuleInit {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(private readonly prisma: PrismaService) {}

  private getGraphqlClient() {
    return new GraphQLClient(this.endpoint);
  }
  private client = this.getGraphqlClient();

  private sdk = getSdk(this.client);

  async onModuleInit() {
    logger.info(`call First time QUEUE_NAME_MARKETPLACE_STATUS`); // Run the task once immediately upon service start
    // await this.handleSyncMarketPlaceStatus();
    await this.handleSyncDataOrder();
  }

  // @Cron(CronExpression.EVERY_10_SECONDS)
  async callEach10SecondSyncDataOrrders() {
    try {
      logger.info(`call per 10 seconds`); // Run the task once immediately upon service start
      // await this.handleSyncMarketPlaceStatus();
    } catch (error) {
      logger.error(
        `Sync data Orders Fail 10 seconds: ${JSON.stringify(error)}`,
      );
    }
  }

  async handleSyncDataOrder() {
    try {
      const lastItem = await this.getLastSyncedItem(SYNCDATASTATUS.ORDER);
      let skip = 0;
      const first = 1000;
      let hasMore = true;
      let lastProcessedTimestamp = 0;
      if (lastItem && lastItem.syncDataStatus === true) {
        await this.updateSyncStatus(SYNCDATASTATUS.ORDER, false);
        logger.info('Sync data Order is already running');
        return;
      }

      // Đặt syncDataStatus là true để chỉ ra rằng quá trình sync đang chạy
      await this.updateSyncStatus(SYNCDATASTATUS.ORDER, true, 0);

      while (hasMore) {
        const variables = {
          first,
          skip,
          orderDirection: OrderDirection.Asc,
          timestamp: lastItem?.timestamp || 0,
        };

        const response = await this.sdk.GetOrders(variables);
        if (response && response.orders && response.orders.length > 0) {
          await this.processOrders(response.orders);
          const lastTimeStamp = response.orders.pop();
          lastProcessedTimestamp = parseInt(lastTimeStamp?.timestamp);
          skip += first;
        } else {
          hasMore = false;
        }
      }
      if (lastProcessedTimestamp > 0) {
        await this.updateSyncStatus(
          SYNCDATASTATUS.ORDER,
          false,
          lastProcessedTimestamp,
        );
      } else {
        await this.updateSyncStatus(SYNCDATASTATUS.ORDER, false);
      }
      logger.info('Sync data Orders successful');
    } catch (error) {
      logger.error(`handleSync DataOrder: ${JSON.stringify(error)}`);
    }
  }

  async processOrders(events) {
    Promise.all(
      events.map(async (item) => {
        if (item.sig || item.index) {
          const status =
            item.status === ORDERSTATUS.FILLED
              ? ORDERSTATUS.FILLED
              : ORDERSTATUS.CANCELLED;
          await this.updateOrder(item.sig, item.index, item?.taker?.id, status);
        }
      }),
    );
  }

  async updateOrder(
    sig: string,
    index: number,
    taker: string,
    status: ORDERSTATUS,
  ) {
    try {
      const checkExists = await this.prisma.order.findUnique({
        where: {
          sig_index: {
            sig: sig,
            index: index,
          },
        },
      });

      const userTaker = await this.fetchOrCreateUser(taker);

      if (checkExists) {
        await this.prisma.order.update({
          where: {
            sig_index: {
              sig: sig,
              index: index,
            },
          },
          data: {
            takerId: userTaker ? userTaker.id : null,
            orderStatus: status,
          },
        });
      }
    } catch (error) {
      logger.error(`updateOrder: ${JSON.stringify(error)}`);
    }
  }

  async fetchOrCreateUser(address: string) {
    try {
      if (address == '0x0000000000000000000000000000000000000000') {
        return null;
      }
      // Attempt to find the user by their address
      let user = await this.prisma.user.findFirst({
        where: {
          signer: address.toLowerCase(),
        },
      });
      // If the user doesn't exist, create a new one
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            signer: address.toLowerCase(),
            publicKey: address.toLowerCase(),
          },
        });
      }
      return user;
    } catch (error) {
      console.log(error);
    }
  }

  // async handleSyncMarketPlaceStatus() {
  //   try {
  //     await Promise.all([
  //       this.handleSyncMarketPlaceStatus721(),
  //       this.handleSyncMarketPlaceStatus1155(),
  //     ]);
  //   } catch (error) {
  //     logger.error(`Sync data marketplace Fail: ${JSON.stringify(error)}`);
  //   }
  // }

  // async handleSyncMarketPlaceStatus721() {
  //   try {
  //     const lastItem = await this.getLastSyncedItem(CONTRACT_TYPE.ERC721);

  //     let skip = 0;
  //     const first = 1000;
  //     let hasMore = true;
  //     let lastProcessedTimestamp = 0;
  //     // Nếu syncDataStatus là true, tức là quá trình sync đang chạy, không thực hiện gì cả
  //     if (lastItem && lastItem.syncDataStatus === true) {
  //       await this.updateSyncStatus(CONTRACT_TYPE.ERC721, false);
  //       logger.info('Sync data marketplace status 721s is already running');
  //       return;
  //     }

  //     // Đặt syncDataStatus là true để chỉ ra rằng quá trình sync đang chạy
  //     await this.updateSyncStatus(CONTRACT_TYPE.ERC721, true, 0);

  //     while (hasMore) {
  //       const variables = {
  //         first,
  //         skip,
  //         orderDirection: OrderDirection.Asc,
  //         timestamp: lastItem?.timestamp || 0,
  //       };

  //       const response = await this.sdk.GetMarketplaceStatus721(variables);
  //       if (
  //         response &&
  //         response.marketEvent721S &&
  //         response.marketEvent721S.length > 0
  //       ) {
  //         await this.processMarketEvents721(response.marketEvent721S);
  //         lastProcessedTimestamp = parseInt(
  //           response.marketEvent721S[response.marketEvent721S.length - 1]
  //             .timestamp,
  //         );
  //         skip += first;
  //       } else {
  //         hasMore = false;
  //       }
  //     }
  //     if (lastProcessedTimestamp > 0) {
  //       await this.updateSyncStatus(
  //         CONTRACT_TYPE.ERC721,
  //         false,
  //         lastProcessedTimestamp,
  //       );
  //     } else {
  //       await this.updateSyncStatus(CONTRACT_TYPE.ERC721, false);
  //     }
  //     logger.info('Sync data marketplace status 721s successful');
  //   } catch (error) {
  //     console.error(error);
  //     logger.error(
  //       `Sync data marketplace status 721s Fail: ${JSON.stringify(error)}`,
  //     );
  //   }
  // }

  // async handleSyncMarketPlaceStatus1155() {
  //   try {
  //     const lastItem = await this.getLastSyncedItem(CONTRACT_TYPE.ERC1155);

  //     let skip = 0;
  //     const first = 1000;
  //     let hasMore = true;
  //     let lastProcessedTimestamp = 0;
  //     // Nếu syncDataStatus là true, tức là quá trình sync đang chạy, không thực hiện gì cả
  //     if (lastItem && lastItem.syncDataStatus === true) {
  //       await this.updateSyncStatus(CONTRACT_TYPE.ERC1155, false);
  //       logger.info('Sync data marketplace status 1155s is already running');
  //       return;
  //     }

  //     // Đặt syncDataStatus là true để chỉ ra rằng quá trình sync đang chạy
  //     await this.updateSyncStatus(CONTRACT_TYPE.ERC1155, true);
  //     while (hasMore) {
  //       const variables = {
  //         first,
  //         skip,
  //         orderDirection: OrderDirection.Asc,
  //         timestamp: lastItem?.timestamp || 0,
  //       };
  //       const response = await this.sdk.GetMarketplaceStatus1155(variables);
  //       if (
  //         response &&
  //         response.marketEvent1155S &&
  //         response.marketEvent1155S.length > 0
  //       ) {
  //         await this.processMarketEvents1155(response.marketEvent1155S);
  //         lastProcessedTimestamp = parseInt(
  //           response.marketEvent1155S[response.marketEvent1155S.length - 1]
  //             .timestamp,
  //         );
  //         skip += first;
  //       } else {
  //         hasMore = false;
  //       }
  //     }
  //     if (lastProcessedTimestamp > 0) {
  //       await this.updateSyncStatus(
  //         CONTRACT_TYPE.ERC1155,
  //         false,
  //         lastProcessedTimestamp,
  //       );
  //     } else {
  //       await this.updateSyncStatus(CONTRACT_TYPE.ERC1155, false);
  //     }

  //     logger.info('Sync data marketplace status 1155s successful');
  //   } catch (error) {
  //     logger.error(`Sync data marketplace status 1155s Fail: ${error}`);
  //   }
  // }

  // async processMarketEvents721(events) {
  //   Promise.all(
  //     events.map(async (item) => {
  //       if (item.nftId || item.tokenId) {
  //         const nft = await this.getNFT(item.tokenId, item?.address);
  //         if (nft) {
  //           const timestamp = parseInt(item.timestamp);
  //           if (item.event === SELL_STATUS.AskNew) {
  //             await this.createMarketplaceStatus721(nft, item, timestamp);
  //           } else if (
  //             item.event === SELL_STATUS.AskCancel ||
  //             item.event === SELL_STATUS.Trade
  //           ) {
  //             await this.deleteMarketplaceStatus(
  //               nft,
  //               item,
  //               CONTRACT_TYPE.ERC721,
  //             );
  //           }
  //         }
  //       }
  //     }),
  //   );
  // }

  // async processMarketEvents1155(events) {
  //   await Promise.all(
  //     events.map(async (item) => {
  //       if (item.nftId || item.tokenId) {
  //         const nft = await this.getNFT(item.tokenId, item?.address);
  //         if (nft) {
  //           const timestamp = parseInt(item.timestamp);
  //           if (item.event === SELL_STATUS.AskNew) {
  //             await this.createMarketplaceStatus1155(nft, item, timestamp);
  //           } else if (
  //             item.event === SELL_STATUS.AskCancel ||
  //             item.event === SELL_STATUS.Trade
  //           ) {
  //             await this.deleteMarketplaceStatus(
  //               nft,
  //               item,
  //               CONTRACT_TYPE.ERC1155,
  //             );
  //           }
  //         }
  //       }
  //     }),
  //   );
  // }

  // async createMarketplaceStatus721(nft, item, timestamp) {
  //   const whereCondition: Prisma.MarketplaceStatusWhereInput = {
  //     tokenId: nft.id,
  //     collectionId: nft.collectionId,
  //   };
  //   const existingMarketplaceStatus =
  //     await this.prisma.marketplaceStatus.findFirst({
  //       where: whereCondition,
  //     });
  //   if (!existingMarketplaceStatus) {
  //     await this.prisma.marketplaceStatus.create({
  //       data: {
  //         tokenId: nft.id,
  //         collectionId: nft.collectionId,
  //         quoteToken: item.quoteToken,
  //         timestamp,
  //         price: this.weiToEther(item.price || 0),
  //         priceWei: `${item.price || 0}`,
  //         netPrice: this.weiToEther(item.netPrice || 0),
  //         netPriceWei: `${item.netPrice || 0}`,
  //         event: item.event,
  //         quantity: 1,
  //         operation: item?.operation,
  //         operationId: item?.operationId,
  //         txHash: item?.txHash,
  //         from: item?.from,
  //         askId: item?.id,
  //         // metricPoint: nf
  //       },
  //     });
  //   }
  // }

  // async createMarketplaceStatus1155(nft, item, timestamp) {
  //   const whereCondition: Prisma.MarketplaceStatusWhereInput = {
  //     // price: parseInt(item?.price),
  //     tokenId: nft.id,
  //     collectionId: nft.collectionId,
  //     operationId: item?.operationId,
  //   };
  //   const existingMarketplaceStatus =
  //     await this.prisma.marketplaceStatus.findFirst({
  //       where: whereCondition,
  //     });
  //   if (!existingMarketplaceStatus) {
  //     await this.prisma.marketplaceStatus.create({
  //       data: {
  //         tokenId: nft.id,
  //         collectionId: nft.collectionId,
  //         quoteToken: item.quoteToken,
  //         timestamp,
  //         price: this.weiToEther(item.price || 0),
  //         priceWei: `${item.price || 0}`,
  //         netPrice: this.weiToEther(item.netPrice || 0),
  //         netPriceWei: `${item.netPrice || 0}`,
  //         event: item.event,
  //         quantity: parseInt(item?.quantity),
  //         operation: item?.operation,
  //         operationId: item?.operationId,
  //         txHash: item?.txHash,
  //         from: item?.from,
  //         askId: item?.id,
  //         metricPoint: nft?.metricPoint,
  //       },
  //     });
  //   } else {
  //     await this.prisma.marketplaceStatus.update({
  //       where: { id: existingMarketplaceStatus.id },
  //       data: {
  //         quoteToken: item.quoteToken,
  //         timestamp,
  //         price: this.weiToEther(item.price || 0),
  //         priceWei: `${item.price || 0}`,
  //         netPrice: this.weiToEther(item.netPrice || 0),
  //         netPriceWei: `${item.netPrice || 0}`,
  //         event: item.event,
  //         quantity: parseInt(item?.quantity),
  //         operation: item?.operation,
  //         operationId: item?.operationId,
  //         txHash: item?.txHash,
  //         from: item?.from,
  //         askId: item?.id,
  //         metricPoint: nft?.metricPoint,
  //       },
  //     });
  //   }
  // }

  // async getNFT(tokenId: string, address: string) {
  //   const collection = await this.prisma.collection.findFirst({
  //     where: {
  //       address: address,
  //     },
  //   });

  //   if (collection) {
  //     if (!collection?.isU2U) {
  //       return await this.prisma.nFT.findUnique({
  //         where: {
  //           id_collectionId: {
  //             id: tokenId,
  //             collectionId: collection.id,
  //           },
  //         },
  //         include: {
  //           collection: {
  //             select: {
  //               address: true,
  //               id: true,
  //             },
  //           },
  //         },
  //       });
  //     } else {
  //       return await this.prisma.nFT.findFirst({
  //         where: {
  //           AND: [{ u2uId: tokenId }, { collectionId: collection.id }],
  //         },
  //         include: {
  //           collection: {
  //             select: {
  //               address: true,
  //               id: true,
  //             },
  //           },
  //         },
  //       });
  //     }
  //   }
  // }

  // async deleteMarketplaceStatus(nft, item, type: CONTRACT_TYPE) {
  //   const whereCondition: Prisma.MarketplaceStatusWhereInput =
  //     type == CONTRACT_TYPE.ERC1155
  //       ? {
  //           // price: parseInt(item?.price),
  //           tokenId: nft.id,
  //           collectionId: nft.collectionId,
  //           operationId: item?.operationId,
  //         }
  //       : {
  //           tokenId: nft.id,
  //           collectionId: nft.collectionId,
  //         };
  //   const existingMarketplaceStatus =
  //     await this.prisma.marketplaceStatus.findFirst({
  //       where: whereCondition,
  //     });

  //   if (existingMarketplaceStatus) {
  //     await this.prisma.marketplaceStatus.delete({
  //       where: {
  //         id: existingMarketplaceStatus.id,
  //       },
  //     });
  //     if (
  //       item.event === SELL_STATUS.Trade &&
  //       (nft?.collection?.address == process.env.BASE_ADDR_721 ||
  //         nft?.collection?.address == process.env.BASE_ADDR_1155)
  //     ) {
  //       await MetricCommon.handleMetricFreeMint(
  //         nft.id,
  //         nft.collectionId,
  //         nft.creatorId,
  //         item?.price,
  //       );
  //     }
  //   }
  // }

  async getLastSyncedItem(type: SYNCDATASTATUS) {
    return await this.prisma.syncMasterData.findFirst({
      where: {
        type: type,
      },
      orderBy: {
        timestamp: 'desc',
      },
    });
  }
  weiToEther(wei) {
    return wei / 1000000000000000000; // 1 Ether = 10^18 Wei
  }
  async updateSyncStatus(
    contractType: SYNCDATASTATUS,
    syncDataStatus: boolean,
    timestamp = null,
  ) {
    const dataUpdate: Prisma.SyncMasterDataCreateInput = {
      type: contractType,
      syncDataStatus: syncDataStatus,
    };
    const dataCreate: Prisma.SyncMasterDataCreateInput = {
      type: contractType,
      syncDataStatus: syncDataStatus,
    };
    if (timestamp !== null && timestamp > 0) {
      dataUpdate.timestamp = timestamp;
    }
    if (timestamp === 0) {
      dataCreate.timestamp = 0;
    }

    await this.prisma.syncMasterData.upsert({
      where: { type: contractType },
      update: dataUpdate,
      create: dataCreate,
    });
  }
}
