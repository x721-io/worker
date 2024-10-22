import {
  getSdk,
  GetStakingQueryVariables,
  GetStakingToAddWhiteListQueryVariables,
} from 'src/generated/graphql';
import { PrismaService } from 'src/prisma/prisma.service';
import { QUEUE_NAME_PROJECT } from 'src/constants/Job.constant';
import { InjectQueue, Process, Processor } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { ethers } from 'ethers';
import { abi as roundAbi } from 'abis/Round.json';
import { abi as MemetaverseABI } from 'abis/MemetaverseRound.json';
import { abi as RoundZero } from 'abis/RoundZero.json';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RedisSubscriberService } from './redis.service';
import axios from 'axios';
import { MemetaverseAddr } from 'src/constants/web3Const/address';
import { logger } from 'src/commons';
import { GraphQLClient } from 'graphql-request';

interface ConfigRound {
  id: string;
}

@Processor(QUEUE_NAME_PROJECT)
export class ProjectProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisClient: RedisSubscriberService,
    @InjectQueue(QUEUE_NAME_PROJECT) private projectQueue: Queue,
  ) {}

  private readonly endpointStaking = process.env.SUBGRAPH_URL_STAKING;
  private provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
  private privateKey = process.env.ADMIN_PVK as string;
  private wallet = new ethers.Wallet(this.privateKey, this.provider);

  private getGraphqlClientStaking() {
    return new GraphQLClient(this.endpointStaking);
  }

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
      console.log(`set for round ${i} at ${res[i].end.getTime()}`);
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
        this.wallet,
      );
      const roundContract2 = new ethers.Contract(
        address2,
        roundAbi,
        this.wallet,
      );
      const round = await roundContract1.getRound();

      const remaining = BigInt(round[4]) - BigInt(round[5]);
      const round2 = await roundContract2.getRound();
      const tx = await roundContract1.transferNFTsToNextRound(
        address2,
        round2[6],
      );
      await tx.wait();
    } catch (err) {
      console.error(err);
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async addWhitelist() {
    // TODO: Fetch data
    // TODO: save last whitelisted to redis
    // TODO: call smartcontract to whitelist
    let lastId = await this.redisClient.redisGetSet.get('lastFetchedId');
    let continueFetching = true;
    console.log('last id: ', lastId);
    if (!lastId) {
      lastId = null;
    }

    while (continueFetching) {
      const addresses = [];
      try {
        const response = await axios.get(
          'https://treasury-hunt.memetaverse.club/api/v1/treasuries/d8fd0f3a-2908-45b3-8f2a-354abfba3c90/whitelist-users',
          {
            params: { limit: 5, cursor: lastId },
          },
        );
        const data = response.data;

        if (data.rows.length > 0) {
          const filteredData = (data.rows as any[]).filter(
            (item) => item.id !== lastId,
          );
          addresses.push(...filteredData);

          lastId = data.rows[data.rows.length - 1].id;
          await this.redisClient.set(
            'lastFetchedId',
            lastId,
            Number.MAX_SAFE_INTEGER,
          );
          if (!data.pageInfo.hasNextPage || data.rows.length === 1) {
            continueFetching = false;
            await this.redisClient.set(
              'lastFetchedId',
              parseInt(lastId) + 1,
              Number.MAX_SAFE_INTEGER,
            );
          }
        }
        try {
          if (addresses.length > 0) {
            const stakingContract = new ethers.Contract(
              MemetaverseAddr,
              MemetaverseABI,
              this.wallet,
            );
            const extractedAddr = addresses.map((i) => i.ethAddress);
            console.log('eth add: ', extractedAddr);
            const tx = await stakingContract.addWhitelistBatch(
              extractedAddr,
              extractedAddr.map((i) => true),
              {
                gasLimit: 500000,
              },
            );
            await tx.wait();
          }
        } catch (err) {
          console.log('error nè: ', err);
          throw new Error(err);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        throw new Error('failed');
      }
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

  @Cron('50 23 * * *')
  async addWhiteListZero() {
    try {
      const availableProject = await this.prisma.projectRound.findMany({
        where: {
          AND: [
            { stakeBefore: { gte: new Date() } },
            {
              Project: {
                isActivated: true,
              },
            },
            {
              RoundInfo: {
                type: { in: ['U2UPremintRoundZero', 'U2UMintRoundZero'] },
              },
            },
          ],
        },
      });

      await Promise.all(
        availableProject.map(async (item) => {
          await this.checkStaking(
            item.projectId,
            item.requiredStaking,
            item.address,
          );
        }),
      );
      logger.info('addWhiteListZero Successful');
    } catch (error) {
      logger.error('addWhiteListZero Failed', error.message);
    }
  }

  async checkStaking(
    projectId: string,
    requestStaking: string,
    addressContract: string,
  ) {
    try {
      const roundZeroContract = new ethers.Contract(
        addressContract,
        RoundZero,
        this.wallet,
      );
      const result = await this.prisma.project.findUnique({
        where: {
          id: projectId,
        },
        include: {
          UserProject: {
            select: {
              subscribeDate: true,
              User: {
                select: {
                  id: true,
                  email: true,
                  avatar: true,
                  username: true,
                  publicKey: true,
                  signer: true,
                },
              },
            },
          },
        },
      });
      const { UserProject } = result;
      const client = this.getGraphqlClientStaking();
      const sdk = getSdk(client);

      const mapAddress = [];

      for (const item of UserProject) {
        const { User } = item;
        if (User && User.signer) {
          const variables: GetStakingToAddWhiteListQueryVariables = {
            id: User.signer.toLowerCase(),
            stakedAmount: requestStaking,
          };
          const response = await sdk.getStakingToAddWhiteList(variables);
          const { delegators }: any = response;

          const IsUserWhitelisted =
            await roundZeroContract.checkIsUserWhitelisted(User.signer);

          if (delegators?.[0] && IsUserWhitelisted == false) {
            mapAddress.push(User.signer);
          }
        }
      }
      await this.addWhiteList(mapAddress, addressContract);

      // return listStaking;
    } catch (error) {
      logger.error('checkStaking Failed', error.message);
    }
  }

  async addWhiteList(listAddress: string[], addressContract: string) {
    try {
      const roundZeroContract = new ethers.Contract(
        addressContract,
        RoundZero,
        this.wallet,
      );
      if (roundZeroContract && listAddress?.length > 0) {
        const tx = await roundZeroContract.addWhitelistOwner(listAddress);
        await tx.wait();
      }
    } catch (error) {
      console.log(error);
      logger.error('addWhiteList Failed', error);
    }
  }
}
