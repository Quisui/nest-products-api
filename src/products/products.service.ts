import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { DataSource, Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { PaginationDto } from 'src/common/dtos/pagination.dto';
import { validate as isUUID } from 'uuid';
import { IsString } from 'class-validator';
import { ProductImage } from './entities';
@Injectable()
export class ProductsService {
  private logger = new Logger('ProductsService');

  constructor(
    @InjectRepository(Product)
    public readonly productRepository: Repository<Product>,
    @InjectRepository(ProductImage)
    public readonly productImageRepository: Repository<ProductImage>,
    public readonly dataSource: DataSource,
  ) {}

  async create(createProductDto: CreateProductDto): Promise<Product> {
    try {
      const { images = [], ...productDetails } = createProductDto;
      const product = this.productRepository.create({
        ...productDetails,
        images: images.map((image) =>
          this.productImageRepository.create({ url: image }),
        ),
      }); //this only creates the instance
      await this.productRepository.save(product);

      return product;
    } catch (error) {
      this.handleDBExceptions(error);
    }
  }

  findAll(paginationDto: PaginationDto) {
    const { limit = 10, offset = 0 } = paginationDto;
    return this.productRepository.find({
      take: limit,
      skip: offset,
      relations: { images: true },
    });
  }

  async findOne(term: string): Promise<Product> {
    let product: Product;
    if (isUUID(term)) {
      product = await this.productRepository.findOneBy({
        id: term as unknown as number,
      });
    } else {
      const productQueryBuilder =
        this.productRepository.createQueryBuilder('prod');
      product = await productQueryBuilder
        .where(`slug =:slug`, { slug: term })
        .leftJoinAndSelect('prod.images', 'prodImages')
        .getOne();
    }

    if (!product)
      throw new NotFoundException(`Product with '${term}' not found`);

    return product;
  }

  async update(
    id: string,
    updateProductDto: UpdateProductDto,
  ): Promise<Product> {
    const { images, ...toUpdate } = updateProductDto;
    const queryRunner = this.dataSource.createQueryRunner();
    if (images) {
      await queryRunner.connect();
      await queryRunner.startTransaction();
    }
    try {
      const product = await this.productRepository.preload({
        id: id as unknown as number,
        ...toUpdate,
      });

      if (!product) throw new NotFoundException(`Product '${id}' not found`);
      if (images) {
        await queryRunner.manager.delete(ProductImage, { product: { id } });

        product.images = images.map((image) =>
          this.productImageRepository.create({ url: image }),
        );

        await queryRunner.manager.save(product);
        await queryRunner.commitTransaction();
      }
      await queryRunner.release();

      return await this.productRepository.save(product);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
      this.handleDBExceptions(error);
    }
  }

  async remove(uuid: string) {
    const product = await this.findOne(uuid);
    await this.productRepository.remove(product);
    return;
  }

  private handleDBExceptions(error: any) {
    if (error.code === '23505') {
      throw new BadRequestException(error.detail);
    }

    this.logger.error(error);
    throw new InternalServerErrorException(error);
  }
}
