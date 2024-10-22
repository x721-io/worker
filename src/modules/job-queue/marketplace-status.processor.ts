import { GraphQLClient } from 'graphql-request';
import { OrderDirection, getSdk } from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { QUEUE_NAME_MARKETPLACE_STATUS } from 'src/constants/Job.constant';
import { Processor } from '@nestjs/bull';
import { NotFoundException, OnModuleInit } from '@nestjs/common';
import { logger } from 'src/commons';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CONTRACT_TYPE,
  SELL_STATUS,
  Prisma,
  ORDERSTATUS,
} from '@prisma/client';
import MetricCommon from 'src/commons/Metric.common';
import { MetricCategory, TypeCategory } from 'src/constants/enums/Metric.enum';
import OtherCommon from 'src/commons/Other.common';
import { parse } from 'path';
import { SYNCDATASTATUS } from 'src/constants/enums/Order.enum';
import { CollectionsUtilsProcessor } from './collection-utils.processor';

export class UpdateOrderInput {
  sig: string;
  index: number;
  nonce: string;
  takeQty: string;
  status: ORDERSTATUS;
  filledQty: number;
  takerId: string;
  timestamp: string;
}

@Processor(QUEUE_NAME_MARKETPLACE_STATUS)
export class MarketplaceStatusProcessor implements OnModuleInit {
  private readonly endpoint = process.env.SUBGRAPH_URL;

  constructor(
    private readonly prisma: PrismaService,
    private collectionsUtils: CollectionsUtilsProcessor,
  ) {}

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

  @Cron(CronExpression.EVERY_10_SECONDS)
  async callEach10SecondSyncDataOrrders() {
    try {
      logger.info(`call per 10 seconds`); // Run the task once immediately upon service start
      await this.handleSyncDataOrder();
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

  async processOrders(events: any) {
    Promise.all(
      events.map(async (item: any) => {
        if (item.sig || item.index) {
          const status =
            item.status == ORDERSTATUS.FILLED
              ? ORDERSTATUS.FILLED
              : ORDERSTATUS.CANCELLED;
          await this.updateOrder({
            sig: item?.sig,
            index: item?.index,
            nonce: item?.nonce,
            takeQty: item?.takeQty,
            status,
            filledQty: item?.filledQty,
            takerId: item?.taker?.id,
            timestamp: item?.timestamp,
          });
        }
      }),
    );
  }

  async updateOrder(input: UpdateOrderInput) {
    try {
      const sigIndexCondition = {
        sig_index: {
          sig: input?.sig,
          index: input?.index,
        },
      };

      const checkExists = await this.prisma.order.findUnique({
        where: sigIndexCondition,
      });

      const userTaker = input?.takerId
        ? await this.fetchOrCreateUser(input?.takerId)
        : null;

      if (!checkExists) {
        return;
      }
      if (input?.status == ORDERSTATUS.FILLED) {
        // Update filled quantity
        await this.prisma.order.update({
          data: {
            filledQty: input?.filledQty ? parseInt(`${input?.filledQty}`) : 0,
          },
          where: sigIndexCondition,
        });

        // Update collection volume
        await this.updateVolumeCollection(
          checkExists.collectionId,
          checkExists.priceNum,
          input?.takeQty ? parseInt(input?.takeQty) : 0,
        );

        if (input?.filledQty == checkExists.quantity) {
          await this.prisma.order.update({
            where: sigIndexCondition,
            data: {
              orderStatus: input?.status,
            },
          });
        }
      }

      if (input?.status == ORDERSTATUS.CANCELLED) {
        // Update status to CANCELLED
        await this.prisma.order.update({
          where: sigIndexCondition,
          data: {
            orderStatus: input?.status,
          },
        });

        // Handle floor price update if collection exists
        const collection = await this.prisma.collection.findUnique({
          where: {
            id: checkExists.collectionId,
          },
        });

        if (collection) {
          this.collectionsUtils.handleUpdateFloorPrice(collection.address);
        }
      }
      const checkExistHistory = await this.prisma.orderHistory.findFirst({
        where: {
          sig: input?.sig,
          index: input?.index,
          nonce: input?.nonce,
        },
      });
      if (checkExistHistory) {
        return;
      }
      const data: Prisma.OrderHistoryUncheckedCreateInput = {
        sig: input?.sig,
        index: input?.index,
        nonce: input?.nonce,
        fromId: checkExists?.makerId,
        toId: userTaker ? userTaker.id : checkExists?.takerId,
        qtyMatch: input?.takeQty ? parseInt(input?.takeQty) : 0,
        price: checkExists.price,
        priceNum: checkExists.priceNum,
        timestamp: parseInt(input.timestamp),
      };
      await this.prisma.orderHistory.createMany({
        data: data,
      });
    } catch (error) {
      console.log(error);
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

  async updateVolumeCollection(
    collectionId: string,
    price: number,
    quantity: number,
  ) {
    try {
      const collection = await this.prisma.collection.findUnique({
        where: {
          id: collectionId,
        },
      });
      if (!collection) {
        throw new Error('Collection not found');
      }
      const vol = collection.vol + price * quantity;
      await this.prisma.collection.update({
        where: {
          id: collection.id,
        },
        data: {
          vol: vol,
          volumeWei: `${vol * 10 ** 18}`,
        },
      });
      logger.info(`Update Volume Collection Successfully`);
    } catch (error) {
      logger.error(`updateVolumeCollection: ${JSON.stringify(error)}`);
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

  async updateSyncStatus(
    contractType: string,
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
