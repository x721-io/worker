import {} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { QUEUE_NAME_PROJECT } from 'src/constants/Job.constant';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { ethers } from 'ethers';
import { abi as roundAbi } from 'abis/Round.json';

interface ConfigRound {
  id: string;
}

@Processor(QUEUE_NAME_PROJECT)
export class ProjectProcessor {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAME_PROJECT) private projectQueue: Queue,
  ) {}
  private provider = new ethers.JsonRpcProvider(
    'https://rpc-nebulas-testnet.uniultra.xyz/',
  );

  private privateKey =
    'a67e478b3157fe8f554e58621c12364ac47050d3c6cfb7efb1bc9d18d0d31e98';
  private wallet = new ethers.Wallet(this.privateKey);

  @Process('config-round-timer')
  async configRound(job: Job<ConfigRound>): Promise<void> {
    const { id } = job.data;

    const res = await this.prisma.projectRound.findMany({
      where: {
        projectId: id,
      },
    });
    console.log(res);
    for (let i = 0; i < res.length - 1; i++) {
      await this.scheduleJob(
        'transfer-next-round',
        { address1: res[i].address, address2: res[i + 1].address },
        res[i].end.getTime(),
      );
    }
    // await this.testTimer();
  }

  @Process('transfer-next-round')
  async transferNftNextRound(job: Job<{ address1: string; address2: string }>) {
    try {
      const { address1, address2 } = job.data;
      const roundContract1 = new ethers.Contract(
        address1,
        roundAbi,
        this.provider,
      );
      const roundContract2 = new ethers.Contract(
        address2,
        roundAbi,
        this.provider,
      );
      const round = await roundContract1.getRound();

      console.log(round);
      const remaining = BigInt(round[4]) - BigInt(round[5]);
      console.log(remaining);
      const walletConnect = roundContract2.connect(this.wallet);
      //   const tx = await walletConnect.transferNFTsToNextRound(
      //     address2,
      //     newMaxAmountNFTPerWallet,
      //   );
    } catch (err) {
      console.error(err);
    }
  }

  async scheduleJob(jobName: string, data: any, timestamp: number) {
    const delay = timestamp - Date.now();
    if (delay > 0) {
      const a = await this.projectQueue.add(jobName, data, { delay });
      console.log(a);
    } else {
      console.error('Cannot schedule a job in the past');
    }
  }
}
