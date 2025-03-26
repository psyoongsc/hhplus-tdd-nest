import { Test, TestingModule } from "@nestjs/testing";
import { PointService } from "./point.service";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DatabaseModule } from "../database/database.module";

describe("PointServiceIntegrationTest", () => {
  let pointService: PointService;
  let config: ConfigService;
  let chargeLimit: number;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        ConfigModule.forRoot({
          envFilePath: `.env`,
        }),
      ],
      providers: [PointService],
    }).compile();

    pointService = module.get<PointService>(PointService);
    config = module.get<ConfigService>(ConfigService);
    chargeLimit = Number(config.get<string>("CHARGE_LIMIT", "10000"));
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
         * 50포인트와 100포인트를 동시에 충전하면 150포인트가 되어야 함.
         */
        it("0포인트가 있는 사용자1이 50포인트 충전 요청과 100포인트 충전 요청을 동시에 보낼 경우 150포인트가 되어야 함✅", async () => {
          await Promise.all([pointService.chargePoint(1, 100), pointService.chargePoint(1, 50)]);

          const result = await pointService.getPoint(1);
          expect(result.point).toBe(150);
        });

        /**
         * 최대 한도가 1000포인트라고 가정하고
         * 100포인트와 901포인트를 동시에 충전하면 둘 중 하나는 실패해야 하며
         * 충전 된 포인트는 100포인트 혹은 901포인트여야 함
         */
        it(`사용자1이 100포인트 충전 요청과 남은 한도 보다 많은 포인트 충전 요청을 동시에 보낼 경우 둘 중 하나의 요청은 실패❌`, async () => {
          const [resultA, resultB] = await Promise.allSettled([
            pointService.chargePoint(1, 100),
            pointService.chargePoint(1, chargeLimit - 99),
          ]);

          const isAError = resultA.status === "rejected";
          const isBError = resultB.status === "rejected";

          expect(isAError || isBError).toBe(true);
          expect(isAError && isBError).toBe(false);

          const result = await pointService.getPoint(1);
          if (isAError) expect(result.point).toBe(chargeLimit - 99);
          else expect(result.point).toBe(100);
        });
      });

      describe("usePoint", () => {
        /**
         * 100포인트가 있는 사용자가 50포인트를 동시에 2번 사용하면 0포인트가 되어야 함
         */
        it("100포인트가 있는 사용자1이 50포인트 사용 요청과 50포인트 사용 요청을 동시에 보낼 경우 0포인트가 되어야 함", async () => {
          await pointService.chargePoint(1, 100);
          const chargedPoint = (await pointService.getPoint(1)).point;
          expect(chargedPoint).toBe(100);

          await Promise.all([pointService.usePoint(1, 50), pointService.usePoint(1, 50)]);

          const result = await pointService.getPoint(1);
          expect(result.point).toBe(0);
        });

        /**
         * 100포인트가 있는 사용자가 50포인트, 51포인트 사용을 동시에 요청하면 둘 중 하나는 실패해야 하며
         * 남은 포인트는 50포인트 혹은 49포인트여야 함
         */
        it("100포인트가 있는 사용자1이 50포인트 사용 요청과 51포인트 사용 요청을 동시에 보낼 경우 실패❌", async () => {
          await pointService.chargePoint(1, 100);
          const chargedPoint = (await pointService.getPoint(1)).point;
          expect(chargedPoint).toBe(100);

          const [resultA, resultB] = await Promise.allSettled([
            pointService.usePoint(1, 50),
            pointService.usePoint(1, 51),
          ]);

          const isAError = resultA.status === "rejected";
          const isBError = resultB.status === "rejected";

          expect(isAError || isBError).toBe(true);
          expect(isAError && isBError).toBe(false);

          const result = await pointService.getPoint(1);
          if (isAError) expect(result.point).toBe(49);
          else expect(result.point).toBe(50);
        });
      });
    });
  });
});
