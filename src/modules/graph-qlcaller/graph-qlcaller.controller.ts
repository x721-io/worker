import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { GraphQlcallerService } from './graph-qlcaller.service';
import { CreateGraphQlcallerDto } from './dto/create-graph-qlcaller.dto';
import { UpdateGraphQlcallerDto } from './dto/update-graph-qlcaller.dto';

@Controller('graph-qlcaller')
export class GraphQlcallerController {
  constructor(private readonly graphQlcallerService: GraphQlcallerService) {}

}
