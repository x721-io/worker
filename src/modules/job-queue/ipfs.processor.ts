import {} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { CommonService } from '../common/common.service';
import { QUEUE_NAME_IPFS } from 'src/constants/Job.constant';
import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Prisma } from '@prisma/client';

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
    const collection = await this.prisma.collection.findUnique({
      where: {
        address: collectionAddress.toLowerCase(),
      },
    });
    const Nft = await this.prisma.nFT.findUnique({
      where: {
        id_collectionId: {
          id: tokenId,
          collectionId: collection.id,
        },
      },
      include: {
        collection: true,
        Trait: true,
      },
    });

    const dataUpdate: Prisma.NFTUpdateInput = {
      ...(traits.data.image && { image: traits.data.image }),
      ...(traits.data.name && { name: traits.data.name }),
      ...(traits.data.animation_url && {
        animationUrl: traits.data.animation_url,
      }),
      ...(traits.data.description && {
        description: traits.data.description,
      }),
      // Trait: {
      //   createMany: {
      //     data: traits.data.attributes,
      //     skipDuplicates: true,
      //   },
      // },
    };
    if (Nft && Nft.Trait && Nft.Trait.length <= 0) {
      dataUpdate.Trait = {
        createMany: {
          data: traits.data.attributes,
          skipDuplicates: true,
        },
      };
    }
    await this.prisma.nFT.update({
      where: {
        id_collectionId: {
          id: tokenId,
          collectionId: collection.id,
        },
      },
      data: dataUpdate,
    });
    return true;
  }
}
