import { Prisma } from '@prisma/client';
import { SYNCDATASTATUS } from 'src/constants/enums/Order.enum';
import { PrismaService } from 'src/prisma/prisma.service';

class HelperService {
  constructor(private prisma: PrismaService) {}

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

  isoToTimestamp(isoString: string, IsMilliSecond = true): number {
    if (IsMilliSecond) {
      return Math.floor(new Date(isoString).getTime() / 1000);
    } else {
      return new Date(isoString).getTime();
    }
  }

  timestampToIso(timestamp: number, IsMilliSecond = true): string {
    if (IsMilliSecond) {
      return new Date(timestamp).toISOString();
    } else {
      return new Date(timestamp * 1000).toISOString();
    }
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

  convertPrice(price, quoteToken) {
    const wu2u = process.env.QUOTE_TOKEN_WU2U?.toLowerCase();
    const pusdt = process.env.QUOTE_TOKEN_PUSDT?.toLowerCase();
    const native = process.env.NATIVE_U2U?.toLowerCase();

    const multipliers = {
      [wu2u]: 10 ** 18, // Dynamically assign process.env values as keys
      [pusdt]: 10 ** 6,
      [native]: 10 ** 18,
    };
    // Default to 1 if the quoteToken is not in the multipliers object
    const multiplier = multipliers[quoteToken] || 1;

    return `${price * multiplier}`;
  }
}

export default new HelperService(new PrismaService());
