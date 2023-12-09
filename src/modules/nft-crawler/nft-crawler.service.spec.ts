import { Test, TestingModule } from '@nestjs/testing';
import { NftCrawlerService } from './nft-crawler.service';

describe('NftCrawlerService', () => {
  let service: NftCrawlerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NftCrawlerService],
    }).compile();

    service = module.get<NftCrawlerService>(NftCrawlerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
