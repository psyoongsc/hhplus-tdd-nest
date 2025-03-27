import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PointModule } from "./point/point.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 전체적으로 사용하기 위해
      envFilePath: `.env`,
    }),
    PointModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
