import {} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { CommonService } from '../common/common.service';
import { QUEUE_NAME_IPFS } from 'src/constants/Job.constant';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';

@Processor(QUEUE_NAME_IPFS)
export class IPFSProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly common: CommonService,
  ) {}

  @Process('get-ipfs')
  async updateIPFS(job: Job<any>): Promise<boolean> {
    const { ipfsUrl, collectionAddress, tokenId } = job.data;
    console.log('let see: ', ipfsUrl);
    const traits = await this.common.getFromIpfs(ipfsUrl);
    console.log(collectionAddress);
    const collection = await this.prisma.collection.findUnique({
      where: {
        address: collectionAddress.toLowerCase(),
      },
    });
    await this.prisma.nFT.update({
      where: {
        id_collectionId: {
          id: tokenId,
          collectionId: collection.id,
        },
      },
      data: {
        Trait: {
          createMany: {
            data: traits.data.attribute,
            skipDuplicates: true,
          },
        },
      },
    });
    return true;
  }
}
