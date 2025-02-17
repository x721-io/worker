import { UserBalance } from './../../generated/Template1155/graphql';
import { GraphQLClient } from 'graphql-request';
import {
  GetOffersQueryVariables,
  GetOrdersQuery,
  GetOrdersQueryVariables,
  GetOrdersTransferQueryVariables,
  OrderDirection,
  getSdk,
} from 'src/generated/graphql';
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
import HelperService from '../helper/helper.service';
import helperService from '../helper/helper.service';
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
export class Offer {
  timestamp: string;
  takeQty: string;
  status: string;
  sig: string;
  nonce: string;
  index: number;
  id: string;
  orderType: string;
  filledQty: string;
  tokenId: string;
  maker: User;
  taker: User;
}

export class User {
  onSaleCount: string;
  id: string;
  holdingCount: string;
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
    try {
      logger.info(`call First time QUEUE_NAME_MARKETPLACE_STATUS`); // Run the task once immediately upon service start
      await Promise.all([
        this.handleSyncDataOrder(),
        this.handleSyncDataOrderTransfer(),
        this.handleSyncDataOffer(),
      ]);
    } catch (error) {
      logger.error(`Error in syncing data: ${error.message}`);
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async callEach5SecondSyncDataOrrders() {
    try {
      logger.info(`call per 5 seconds`); // Run the task once immediately upon service start
      await this.handleSyncDataOrder();
    } catch (error) {
      logger.error(`Sync data Orders Fail 5 seconds: ${JSON.stringify(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async callEach5SecondSyncDataOrdersTransfer() {
    try {
      logger.info(`call per 5 seconds`); // Run the task once immediately upon service start
      await this.handleSyncDataOrderTransfer();
    } catch (error) {
      logger.error(`Sync data Orders Fail 5 seconds: ${JSON.stringify(error)}`);
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async callEach5SecondSyncDataOffers() {
    try {
      logger.info(`call per 5 seconds`); // Run the task once immediately upon service start
      await this.handleSyncDataOffer();
    } catch (error) {
      logger.error(`Sync data Offers Fail 5 seconds: ${JSON.stringify(error)}`);
    }
  }

  async handleSyncDataOrderTransfer() {
    try {
      const lastItem = await HelperService.getLastSyncedItem(
        SYNCDATASTATUS.TRANSFER,
      );
      let skip = 0;
      const first = 1000;
      let hasMore = true;
      let lastProcessedTimestamp = 0;
      if (lastItem && lastItem.syncDataStatus === true) {
        await HelperService.updateSyncStatus(SYNCDATASTATUS.TRANSFER, false);
        logger.info('Sync data transfer is already running');
        return;
      }

      // Đặt syncDataStatus là true để chỉ ra rằng quá trình sync đang chạy
      await HelperService.updateSyncStatus(SYNCDATASTATUS.TRANSFER, true, 0);
      while (hasMore) {
        const variables: GetOrdersTransferQueryVariables = {
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
        await HelperService.updateSyncStatus(
          SYNCDATASTATUS.TRANSFER,
          false,
          lastProcessedTimestamp,
        );
      } else {
        await HelperService.updateSyncStatus(SYNCDATASTATUS.TRANSFER, false);
      }
    } catch (error) {
      logger.error(
        `handleSyncDataOrderTransfer DataOrder: ${JSON.stringify(error)}`,
      );
    }
  }

  async handleSyncDataOrder() {
    try {
      const lastItem = await HelperService.getLastSyncedItem(
        SYNCDATASTATUS.ORDER,
      );
      let skip = 0;
      const first = 1000;
      let hasMore = true;
      let lastProcessedTimestamp = 0;
      if (lastItem && lastItem.syncDataStatus === true) {
        await HelperService.updateSyncStatus(SYNCDATASTATUS.ORDER, false);
        logger.info('Sync data Order is already running');
        return;
      }

      // Đặt syncDataStatus là true để chỉ ra rằng quá trình sync đang chạy
      await HelperService.updateSyncStatus(SYNCDATASTATUS.ORDER, true, 0);

      while (hasMore) {
        const variables: GetOrdersQueryVariables = {
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
        await HelperService.updateSyncStatus(
          SYNCDATASTATUS.ORDER,
          false,
          lastProcessedTimestamp,
        );
      } else {
        await HelperService.updateSyncStatus(SYNCDATASTATUS.ORDER, false);
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
        price: helperService.etherToWeiQuoteToken(
          pricesPerItems,
          checkExists.quoteToken,
        ),
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
          volumeWei: (BigInt(vol) * BigInt(10 ** 18)).toString(),
        },
      });
      logger.info(`Update Volume Collection Successfully`);
    } catch (error) {
      logger.error(`updateVolumeCollection: ${JSON.stringify(error)}`);
    }
  }

  async handleSyncDataOffer() {
    try {
      const lastItem = await HelperService.getLastSyncedItem(
        SYNCDATASTATUS.OFFER,
      );
      let skip = 0;
      const first = 1000;
      let hasMore = true;
      let lastProcessedTimestamp = 0;
      if (lastItem && lastItem.syncDataStatus === true) {
        await HelperService.updateSyncStatus(SYNCDATASTATUS.OFFER, false);
        logger.info('Sync data offer is already running');
        return;
      }

      // // Đặt syncDataStatus là true để chỉ ra rằng quá trình sync đang chạy
      await HelperService.updateSyncStatus(SYNCDATASTATUS.OFFER, true, 0);
      while (hasMore) {
        const variables: GetOffersQueryVariables = {
          first,
          skip,
          orderDirection: OrderDirection.Asc,
          timestamp: lastItem?.timestamp || 0,
          orderType: 'BID_COLLECTION',
        };
        const response = await this.sdk.GetOrders(variables);
        if (response && response.orders && response.orders.length > 0) {
          await this.processOffers(response.orders);
          const lastTimeStamp = response.orders.pop();
          lastProcessedTimestamp = parseInt(lastTimeStamp?.timestamp);
          skip += first;
        } else {
          hasMore = false;
        }
      }
      if (lastProcessedTimestamp > 0) {
        await HelperService.updateSyncStatus(
          SYNCDATASTATUS.OFFER,
          false,
          lastProcessedTimestamp,
        );
      } else {
        await HelperService.updateSyncStatus(SYNCDATASTATUS.OFFER, false);
      }
      logger.info(`Update Bid Collection Successfully`);
    } catch (error) {
      logger.error(`handleSync DataOrder: ${JSON.stringify(error)}`);
    }
  }

  async processOffers(events) {
    Promise.allSettled(
      events.map(async (item: Offer) => {
        if (item?.sig && item?.index && item?.tokenId) {
          await this.createOrderOffer(item);
        }
      }),
    );
  }

  async createOrderOffer(input: Offer) {
    try {
      const {
        sig,
        index,
        filledQty,
        tokenId,
        taker,
        takeQty,
        nonce,
        timestamp,
      } = input;

      const offerInfor = await this.prisma.offer.findUnique({
        where: { sig_index: { sig, index } },
      });
      if (!offerInfor) return;

      const nft = await this.prisma.nFT.findFirst({
        where: {
          OR: [
            { id: tokenId, collectionId: offerInfor.collectionId },
            { u2uId: tokenId, collectionId: offerInfor.collectionId },
          ],
        },
      });
      if (!nft) return;

      const userTaker = taker?.id
        ? await this.fetchOrCreateUser(taker.id)
        : null;
      if (!userTaker) return;

      const orderExists = await this.prisma.order.findUnique({
        where: { sig_index: { sig, index: Number(filledQty) } },
      });
      if (orderExists) return;

      const dataOrder: Prisma.OrderUncheckedCreateInput = {
        sig,
        idxOffer: offerInfor.index,
        makerId: offerInfor.makerId,
        makeAssetType: offerInfor.makeAssetType,
        makeAssetAddress: offerInfor.makeAssetAddress,
        makeAssetValue: offerInfor.makeAssetValue,
        makeAssetId: offerInfor.makeAssetId,
        takerId: userTaker.id,
        takeAssetType: offerInfor.takeAssetType,
        takeAssetAddress: offerInfor.takeAssetAddress,
        takeAssetValue: offerInfor.takeAssetValue,
        takeAssetId: nft.u2uId || nft.id,
        salt: offerInfor.salt,
        start: offerInfor.start,
        end: offerInfor.end,
        orderType: ORDERTYPE.BID_COLLECTION,
        orderStatus: ORDERSTATUS.FILLED,
        tokenId: nft.id,
        collectionId: offerInfor.collectionId,
        price: offerInfor.price,
        quantity: parseInt(`${takeQty || 0}`),
        priceNum: offerInfor.priceNum,
        netPrice: offerInfor.netPrice,
        netPriceNum: offerInfor.netPriceNum,
        quoteToken: offerInfor.quoteToken,
        index: parseInt(`${filledQty}`),
        proof: offerInfor.proof,
        root: offerInfor.root,
        filledQty: parseInt(`${takeQty || 0}`),
      };

      const resultOrder = await this.prisma.order.create({ data: dataOrder });
      if (!resultOrder) return;

      await this.updateVolumeCollection(
        resultOrder.collectionId,
        resultOrder.priceNum,
        parseInt(`${takeQty || 0}`),
      );

      const historyExists = await this.prisma.orderHistory.findFirst({
        where: { sig, index: parseInt(`${filledQty}`), nonce },
      });
      if (!historyExists) {
        await this.prisma.orderHistory.create({
          data: {
            sig,
            index,
            nonce,
            fromId: resultOrder.makerId,
            toId: userTaker.id,
            qtyMatch: parseInt(`${takeQty || 0}`),
            price: offerInfor.price,
            timestamp: Number(timestamp),
          },
        });
      }

      await this.prisma.offer.update({
        where: { sig_index: { sig: offerInfor.sig, index: offerInfor.index } },
        data: { filledQty: parseInt(filledQty) },
      });
      if (parseInt(filledQty) === offerInfor.quantity) {
        await this.prisma.offer.update({
          where: {
            sig_index: { sig: offerInfor.sig, index: offerInfor.index },
          },
          data: { offerStatus: ORDERSTATUS.FILLED },
        });
      }
    } catch (error) {
      logger.error(`Create Order Offer: ${JSON.stringify(error)}`);
    }
  }
}
