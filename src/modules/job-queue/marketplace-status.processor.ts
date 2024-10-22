import { UserBalance } from './../../generated/Template1155/graphql';
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
  TX_STATUS,
  ORDERTYPE,
} from '@prisma/client';
import MetricCommon from 'src/commons/Metric.common';
import { MetricCategory, TypeCategory } from 'src/constants/enums/Metric.enum';
import OtherCommon from 'src/commons/Other.common';
import { parse } from 'path';
import { ORDERTRANSFER, SYNCDATASTATUS } from 'src/constants/enums/Order.enum';
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

export class UpdateOrderTransferInput {
  tokenId: string;
  collection: string;
  makerId: string;
  takerId: string;
  timestamp: string;
  takeQty: string;
  status: ORDERTRANSFER;
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
    await this.handleSyncDataOrderTransfer();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async callEach10SecondSyncDataOrrders() {
    try {
      logger.info(`call per 5 seconds`); // Run the task once immediately upon service start
      await this.handleSyncDataOrder();
    } catch (error) {
      logger.error(`Sync data Orders Fail 5 seconds: ${JSON.stringify(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async callEach10SecondSyncDataOrrdersTransfer() {
    try {
      logger.info(`call per 5 seconds`); // Run the task once immediately upon service start
      await this.handleSyncDataOrderTransfer();
    } catch (error) {
      logger.error(`Sync data Orders Fail 5 seconds: ${JSON.stringify(error)}`);
    }
  }

  async handleSyncDataOrderTransfer() {
    try {
      const lastItem = await this.getLastSyncedItem(SYNCDATASTATUS.TRANSFER);
      let skip = 0;
      const first = 1000;
      let hasMore = true;
      let lastProcessedTimestamp = 0;
      if (lastItem && lastItem.syncDataStatus === true) {
        await this.updateSyncStatus(SYNCDATASTATUS.TRANSFER, false);
        logger.info('Sync data transfer is already running');
        return;
      }

      // Đặt syncDataStatus là true để chỉ ra rằng quá trình sync đang chạy
      await this.updateSyncStatus(SYNCDATASTATUS.TRANSFER, true, 0);
      while (hasMore) {
        const variables = {
          first,
          skip,
          orderDirection: OrderDirection.Asc,
          timestamp: lastItem?.timestamp || 0,
        };

        const response = await this.sdk.GetOrdersTransfer(variables);
        if (
          response &&
          response.orderTransfers &&
          response.orderTransfers.length > 0
        ) {
          await this.processOrdersTransfer(response.orderTransfers);
          const lastTimeStamp = response.orderTransfers.pop();
          lastProcessedTimestamp = parseInt(lastTimeStamp?.timestamp);
          skip += first;
        } else {
          hasMore = false;
        }
      }
      if (lastProcessedTimestamp > 0) {
        await this.updateSyncStatus(
          SYNCDATASTATUS.TRANSFER,
          false,
          lastProcessedTimestamp,
        );
      } else {
        await this.updateSyncStatus(SYNCDATASTATUS.TRANSFER, false);
      }
    } catch (error) {
      logger.error(
        `handleSyncDataOrderTransfer DataOrder: ${JSON.stringify(error)}`,
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

  async processOrdersTransfer(events: any) {
    Promise.allSettled(
      events.map(async (item: any) => {
        if (item?.tokenId && item?.collection) {
          await this.updateOrderTransfer(item);
        }
      }),
    );
  }

  async updateOrderTransfer(input: any) {
    try {
      const collection = await this.prisma.collection.findUnique({
        where: {
          address: input.collection.toLowerCase(),
        },
      });
      if (!collection) {
        return;
      }
      const nftExists = await this.prisma.nFT.findFirst({
        where: {
          collectionId: collection.id,
          OR: [{ u2uId: input?.tokenId }, { id: input?.tokenId }],
        },
      });
      if (!nftExists) {
        return;
      }

      const makerUser = await this.prisma.user.findUnique({
        where: {
          signer: input.maker?.id?.toLowerCase(),
        },
      });
      if (!makerUser) {
        return;
      }
      if (input?.status == ORDERTRANSFER.TRANSFER) {
        if (collection.type == CONTRACT_TYPE.ERC721) {
          const orderBuySell = await this.prisma.order.findFirst({
            where: {
              orderStatus: ORDERSTATUS.OPEN,
              orderType: { in: [ORDERTYPE.BULK, ORDERTYPE.SINGLE] },
              start: {
                lte: Math.floor(Date.now() / 1000),
              },
              end: {
                gte: Math.floor(Date.now() / 1000),
              },
              collectionId: collection.id,
              tokenId: nftExists.id,
              makerId: makerUser?.id,
            },
          });

          await this.prisma.order.update({
            where: {
              sig_index: {
                sig: orderBuySell.sig,
                index: orderBuySell.index,
              },
            },
            data: {
              filledQty: orderBuySell.quantity,
              orderStatus: ORDERSTATUS.CANCELLED,
            },
          });
        } else {
          const tokenId = `${makerUser?.signer}-${collection.address}-${nftExists.u2uId ? nftExists.u2uId : nftExists.id}`;
          const { erc1155Balance } = await this.sdk.userBalance1155({
            id: tokenId,
          });
          if (erc1155Balance) {
            const orderBuySell = await this.prisma.order.findFirst({
              where: {
                orderStatus: ORDERSTATUS.OPEN,
                orderType: { in: [ORDERTYPE.BULK, ORDERTYPE.SINGLE] },
                start: {
                  lte: Math.floor(Date.now() / 1000),
                },
                end: {
                  gte: Math.floor(Date.now() / 1000),
                },
                collectionId: collection.id,
                tokenId: nftExists.id,
                makerId: makerUser?.id,
              },
            });
            if (orderBuySell) {
              if (erc1155Balance?.valueExact < orderBuySell?.quantity) {
                // Update filled Qty
                await this.prisma.order.update({
                  where: {
                    sig_index: {
                      sig: orderBuySell.sig,
                      index: orderBuySell.index,
                    },
                  },
                  data: {
                    filledQty: parseInt(input?.takeQty),
                  },
                });
              }
              if (erc1155Balance?.valueExact <= 0) {
                // Cancle Buy
                await this.prisma.order.update({
                  where: {
                    sig_index: {
                      sig: orderBuySell.sig,
                      index: orderBuySell.index,
                    },
                  },
                  data: {
                    filledQty: orderBuySell.quantity,
                    orderStatus: ORDERSTATUS.CANCELLED,
                  },
                });
              }
            }
          }
        }
      }
      // return;
    } catch (error) {
      console.log(error);
      logger.error(`updateOrder: ${JSON.stringify(error)}`);
    }
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
      const pricesPerItems =
        checkExists?.orderType == 'BID'
          ? parseFloat(
              `${checkExists.priceNum / Number(checkExists?.quantity)}`,
            )
          : checkExists.priceNum;
      const data: Prisma.OrderHistoryUncheckedCreateInput = {
        sig: input?.sig,
        index: input?.index,
        nonce: input?.nonce,
        fromId: checkExists?.makerId,
        toId: userTaker ? userTaker.id : checkExists?.takerId,
        qtyMatch: input?.takeQty ? parseInt(input?.takeQty) : 0,
        price: `${pricesPerItems * 10 ** 18}`,
        priceNum: pricesPerItems,
        timestamp: Number(input.timestamp),
      };
      await this.prisma.orderHistory.create({
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
