import { Test, TestingModule } from "@nestjs/testing";
import { PointService } from "./point.service";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module";

describe("PointServiceIntegrationTest", () => {
  let pointService: PointService;
  let config: ConfigService;
  let configServiceStub: Partial<ConfigService>;
  let chargeLimit: number;

  beforeEach(async () => {
    configServiceStub = {
      get: (key: string) => {
        if (key === "CHARGE_LIMIT") return "1000";
        return null;
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        ConfigModule.forRoot({
          envFilePath: `.env`,
        }),
      ],
      providers: [
        PointService,
        { provide: ConfigService, useValue: configServiceStub },
      ],
    }).compile();

    pointService = module.get<PointService>(PointService);
    config = module.get<ConfigService>(ConfigService);
    chargeLimit = Number(config.get<string>("CHARGE_LIMIT", "1000"));
  });

  it("should be defined", () => {
    expect(pointService).toBeDefined();
    expect(config).toBeDefined();
  });

  describe("통합 테스트", () => {
    /**
     * 100포인트가 충전 되어 있는 사용자에게 최대 한도에 걸리지 않도록 포인트를 충전을 하면 정상적으로 충전 되어야 함
     */
    it("100포인트가 충전 된 사용자1이 200포인트를 충전하면 300포인트가 있어야 함✅", async () => {
      await pointService.chargePoint(1, 100);
      const chargedPoint = await (await pointService.getPoint(1)).point;
      expect(chargedPoint).toBe(100);

      await pointService.chargePoint(1, 200);
      const result = await pointService.getPoint(1);
      expect(result.point).toBe(300);
    })

    /**
     * 100포인트가 충전 되어 있는 사용자에게 최대 한도에 걸리도록 포인트를 충전하면 충전되지 않아야 함
     */
    it("100포인트가 충전 된 사용자1이 최대 한도 보다 많이 충전하려 하면 그대로 100포인트가 있어야 함❌", async () => {
      await pointService.chargePoint(1, 100);
      const chargedPoint = await (await pointService.getPoint(1)).point;
      expect(chargedPoint).toBe(100);

      await expect(pointService.chargePoint(1, chargeLimit - 99)).rejects.toThrow(`충전할 수 있는 최대 포인트는 ${chargeLimit} 입니다.`)
      const result = await pointService.getPoint(1);
      expect(result.point).toBe(100);
    })

    /**
     * 100포인트가 충전 되어 있는 사용자가 100포인트 이하로 사용을 요청하면 정상적으로 사용되어야 함
     */
    it("100포인트가 충전 된 사용자1이 50포인트를 사용하면 50포인트가 있어야 함✅", async () => {
      await pointService.chargePoint(1, 100);
      const chargedPoint = await (await pointService.getPoint(1)).point;
      expect(chargedPoint).toBe(100);

      await pointService.usePoint(1, 50);
      const result = await pointService.getPoint(1);
      expect(result.point).toBe(50);
    })

    /**
     * 150포인트가 충전되어 있는 사용자가 150포인트 보다 많이 사용하려 하면 사용되지 않아야 함
     */
    it("150포인트가 충전 된 사용자1이 151포인트를 사용하려 하면 그대로 150포인트가 있어야 함❌", async () => {
      await pointService.chargePoint(1, 150);
      const chargedPoint = await (await pointService.getPoint(1)).point;
      expect(chargedPoint).toBe(150);

      await expect(pointService.usePoint(1, 151)).rejects.toThrow("포인트가 부족합니다.")
      const result = await pointService.getPoint(1);
      expect(result.point).toBe(150);
    })

    describe("동시성 테스트", () => {
      /**
       * DB 에 race condition 이 발생할 수 있는 상황에서 동시 요청을 할 시 모두 적절히 반영되어야 함
       */
      describe("chargePoint", () => {
        /**
         * 최대 한도가 1000포인트라고 가정하고
         * 500포인트 충전을 동시에 5번 하는 경우 3번은 실패하고
         * 보유 포인트는 1000포인트 여야 함.
         */
        it(`사용자1이 500포인트 충전을 동시에 5번 하는 경우 3번의 요청을 실패하고 1000포인트가 충전되어 있어야 함❌`, async () => {
          const responseArray = await Promise.allSettled(
            Array.from({ length: 5 }, (_, i) => pointService.chargePoint(1, 500))
          );

          const successCount = responseArray.filter((response) => response.status === "fulfilled").length;
          const failCount = responseArray.filter((response) => response.status === "rejected").length;

          expect(successCount).toBe(2);
          expect(failCount).toBe(3);

          const result = await pointService.getPoint(1);
          expect(result.point).toBe(1000);
        });
      });

      describe("usePoint", () => {
        /**
         * 1000포인트가 있는 사용자가
         * 500포인트 사용을 동시에 5번 하는 경우 3번은 실패하고
         * 보유 포인트는 0포인트가 되어야 함.
         */
        it("1000포인트가 있는 사용자1이 500포인트 사용을 동시에 5번 하는 경우 3번의 요청을 실패하고 0포인트가 남아 있어야 함❌", async () => {
          await pointService.chargePoint(1, 1000);
          const chargedPoint = (await pointService.getPoint(1)).point;
          expect(chargedPoint).toBe(1000);

          const responseArray = await Promise.allSettled(
            Array.from({ length: 5 }, (_, i) => pointService.usePoint(1, 500))
          );

          const successCount = responseArray.filter((response) => response.status === "fulfilled").length;
          const failCount = responseArray.filter((response) => response.status === "rejected").length;

          expect(successCount).toBe(2);
          expect(failCount).toBe(3);

          const result = await pointService.getPoint(1);
          expect(result.point).toBe(0);
        });
      });
    });
  });
});
