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
}

export default new HelperService(new PrismaService());
