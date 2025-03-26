import { Test, TestingModule } from "@nestjs/testing";
import { PointService } from "./point.service";
import { UserPointTable } from "../database/userpoint.table";
import { PointHistoryTable } from "../database/pointhistory.table";
import { TransactionType } from "./point.model";
import { ConfigService } from "@nestjs/config";

describe("PointServiceUnitTest", () => {
  let pointService: PointService;
  let userDbStub: Partial<UserPointTable>;
  let historyDbStub: Partial<PointHistoryTable>;
  let config: ConfigService;
  let configServiceStub: Partial<ConfigService>;
  let chargeLimit: number;

  beforeEach(async () => {
    userDbStub = {
      selectById: jest.fn(),
      insertOrUpdate: jest.fn(),
    };

    historyDbStub = {
      selectAllByUserId: jest.fn(),
      insert: jest.fn(),
    };

    configServiceStub = {
      get: (key: string) => {
        if (key === "CHARGE_LIMIT") return "10000";
        return null;
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PointService,
        { provide: UserPointTable, useValue: userDbStub },
        { provide: PointHistoryTable, useValue: historyDbStub },
        { provide: ConfigService, useValue: configServiceStub },
      ],
    }).compile();

    pointService = module.get<PointService>(PointService);
    config = module.get<ConfigService>(ConfigService);
    chargeLimit = Number(config.get<string>("CHARGE_LIMIT", "10000"));
  });

  it("should be defined", () => {
    expect(pointService).toBeDefined();
  });

  describe("유닛 테스트", () => {
    describe("getPoint", () => {
      /**
       * DB에 저장된 데이터를 전달받아서 정확히 반환하는지 확인
       */
      it("사용자1이 가진 포인트를 확인하면 100포인트가 있음✅", async () => {
        const mockUserPoint = { id: 1, point: 100, updateMillis: Date.now() };
        (userDbStub.selectById as jest.Mock).mockResolvedValue(mockUserPoint);

        const result = await pointService.getPoint(1);

        expect(result).toBeDefined();
        expect(userDbStub.selectById).toHaveBeenCalledWith(1);
        expect(result).toEqual(mockUserPoint);
      });

      /**
       * id 인자가 양의 정수로 입력되지 않았을 경우 "올바르지 않은 ID 값 입니다." 라는 Error 를 반환하는지 확인
       */
      it("사용자의 ID 값을 양의 정수 형태로 주지 않을 경우 실패❌", async () => {
        await expect(pointService.getPoint(0)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getPoint(-1)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getPoint(1.5)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getPoint(NaN)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getPoint(Infinity)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getPoint(-Infinity)).rejects.toThrow("올바르지 않은 ID 값 입니다.");

        expect(userDbStub.selectById).not.toHaveBeenCalled();
      });
    });

    describe("getHistories", () => {
      /**
       * DB에 저장된 데이터를 전달받아서 정확히 반환하는지 확인
       */
      it("사용자1이 포인트를 충전/사용한 내역을 확인하면 2건의 내역이 있음✅", async () => {
        const mockHistories = [
          { id: 1, userId: 1, amount: 50, type: TransactionType.CHARGE, timestamp: Date.now() },
          { id: 2, userId: 1, amount: 50, type: TransactionType.USE, timestamp: Date.now() },
        ];
        (historyDbStub.selectAllByUserId as jest.Mock).mockResolvedValue(mockHistories);

        const result = await pointService.getHistories(1);

        expect(historyDbStub.selectAllByUserId).toHaveBeenCalledWith(1);
        expect(result).toEqual(mockHistories);
      });

      /**
       * id 인자가 양의 정수로 입력되지 않았을 경우 "올바르지 않은 ID 값 입니다." 라는 Error 를 반환하는지 확인
       */
      it("사용자의 ID 값을 양의 정수 형태로 주지 않을 경우 실패❌", async () => {
        await expect(pointService.getHistories(0)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getHistories(-1)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getHistories(1.5)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getHistories(NaN)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.getHistories(Infinity)).rejects.toThrow("올바르지 않은 ID 값 입니다.");

        expect(historyDbStub.selectAllByUserId).not.toHaveBeenCalled();
      });
    });

    describe("chargePoint", () => {
      /**
       * 기존에 가진 포인트에 추가로 포인트를 충전할 수 있는지 확인
       * 충전한 내역을 history DB 에도 저장하는지 확인
       */
      it("100포인트가 있는 사용자1에게 50포인트를 추가하면 총 150포인트가 됨✅", async () => {
        const mockUserPoint = { id: 1, point: 100, updateMillis: Date.now() };
        const mockUserUpdatedPoint = { id: 1, point: 150, updateMillis: Date.now() };
        const mockHistory = {
          id: expect.any(Number),
          userId: 1,
          amount: 50,
          type: TransactionType.CHARGE,
          timeMillis: expect.any(Number),
        };
        (userDbStub.selectById as jest.Mock).mockResolvedValue(mockUserPoint);
        (userDbStub.insertOrUpdate as jest.Mock).mockResolvedValue(mockUserUpdatedPoint);
        (historyDbStub.insert as jest.Mock).mockResolvedValue(mockHistory);

        const result = await pointService.chargePoint(1, 50);

        expect(userDbStub.selectById).toHaveBeenCalledWith(1);
        expect(userDbStub.insertOrUpdate).toHaveBeenCalledWith(1, 150);
        expect(historyDbStub.insert).toHaveBeenCalledWith(1, 50, TransactionType.CHARGE, expect.any(Number));
        expect(result.point).toBe(150);
      });

      /**
       * 최대 한도로 설정한 수치까지 포인트를 충전할 수 있는지 확인
       * 충전한 내역을 history DB 에도 저장하는지 확인
       */
      it("100포인트가 있는 사용자1에게 남은 한도를 모두 충전하면 최대 한도까지 충전 됨✅", async () => {
        const mockUserPoint = { id: 1, point: 100, updateMillis: Date.now() };
        const mockUserUpdatedPoint = { id: 1, point: chargeLimit, updateMillis: Date.now() };
        const mockHistory = {
          id: expect.any(Number),
          userId: 1,
          amount: chargeLimit - 100,
          type: TransactionType.CHARGE,
          timeMillis: expect.any(Number),
        };
        (userDbStub.selectById as jest.Mock).mockResolvedValue(mockUserPoint);
        (userDbStub.insertOrUpdate as jest.Mock).mockResolvedValue(mockUserUpdatedPoint);
        (historyDbStub.insert as jest.Mock).mockResolvedValue(mockHistory);

        const result = await pointService.chargePoint(1, chargeLimit - 100);

        expect(userDbStub.selectById).toHaveBeenCalledWith(1);
        expect(userDbStub.insertOrUpdate).toHaveBeenCalledWith(1, chargeLimit);
        expect(historyDbStub.insert).toHaveBeenCalledWith(
          1,
          chargeLimit - 100,
          TransactionType.CHARGE,
          expect.any(Number),
        );
        expect(result.point).toBe(chargeLimit);
      });

      /**
       * id 인자가 양의 정수로 입력되지 않았을 경우 "올바르지 않은 ID 값 입니다." 라는 Error 를 반환하는지 확인
       * 실패 하였기 때문에 userDB, historyDB 에 저장하는 행위를 하지 않는지 확인
       */
      it("사용자의 ID 값을 양의 정수 형태로 주지 않을 경우 실패❌", async () => {
        await expect(pointService.chargePoint(0, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.chargePoint(-1, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.chargePoint(1.5, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.chargePoint(NaN, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.chargePoint(Infinity, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");

        expect(userDbStub.insertOrUpdate).not.toHaveBeenCalled();
        expect(historyDbStub.insert).not.toHaveBeenCalled();
      });

      /**
       * 충전할 액수를 양의 정수로 입력하지 않았을 경우 "충전할 포인트는 정수여야 하며 0보다 커야합니다." 라는 Error 를 반환하는지 확인
       * 실패 하였기 때문에 userDB, historyDB 에 저장하는 행위를 하지 않는지 확인
       */
      it("음수, 0, 실수, NaN, Infinity 값으로 포인트를 충전할 경우 실패❌", async () => {
        await expect(pointService.chargePoint(1, -100)).rejects.toThrow(
          "충전할 포인트는 정수여야 하며 0보다 커야합니다.",
        );
        await expect(pointService.chargePoint(1, 0)).rejects.toThrow("충전할 포인트는 정수여야 하며 0보다 커야합니다.");
        await expect(pointService.chargePoint(1, 1.5)).rejects.toThrow(
          "충전할 포인트는 정수여야 하며 0보다 커야합니다.",
        );
        await expect(pointService.chargePoint(1, NaN)).rejects.toThrow(
          "충전할 포인트는 정수여야 하며 0보다 커야합니다.",
        );
        await expect(pointService.chargePoint(1, Infinity)).rejects.toThrow(
          "충전할 포인트는 정수여야 하며 0보다 커야합니다.",
        );

        expect(userDbStub.insertOrUpdate).not.toHaveBeenCalled();
        expect(historyDbStub.insert).not.toHaveBeenCalled();
      });

      /**
       * 남은 한도 보다 1원 많은 포인트를 충전하려 하는 경우 설정한 최대 한도에 맞춰서 Error 메시지가 출력되는지 확인
       * 실패 하였기 때문에 userDB, historyDB 에 저장하는 행위를 하지 않는지 확인
       */
      it("100포인트가 있는 사용자1에게 남은 한도 보다 많은 포인트를 충전할 경우 실패❌", async () => {
        const mockUserPoint = { id: 1, point: 100, updateMillis: Date.now() };
        (userDbStub.selectById as jest.Mock).mockResolvedValue(mockUserPoint);

        await expect(pointService.chargePoint(1, chargeLimit - 99)).rejects.toThrow(
          `충전할 수 있는 최대 포인트는 ${chargeLimit} 입니다.`,
        );

        expect(userDbStub.insertOrUpdate).not.toHaveBeenCalled();
        expect(historyDbStub.insert).not.toHaveBeenCalled();
      });
    });

    describe("usePoint", () => {
      /**
       * 포인트를 보유하고 있는 사용자가 가진 포인트를 사용 후 정확히 사용 금액이 차감되는지 확인
       * 사용한 내역을 history DB 에도 저장하는지 확인
       */
      it("100포인트가 있는 사용자1이 100포인트를 사용할 경우 성공✅", async () => {
        const mockUserPoint = { id: 1, point: 100, updateMillis: Date.now() };
        const mockUserUpdatedPoint = { id: 1, point: 0, updateMillis: Date.now() };
        const mockHistory = {
          id: expect.any(Number),
          userId: 1,
          amount: 100,
          type: TransactionType.USE,
          timeMillis: expect.any(Number),
        };
        (userDbStub.selectById as jest.Mock).mockResolvedValue(mockUserPoint);
        (userDbStub.insertOrUpdate as jest.Mock).mockResolvedValue(mockUserUpdatedPoint);
        (historyDbStub.insert as jest.Mock).mockResolvedValue(mockHistory);

        const result = await pointService.usePoint(1, 100);

        expect(userDbStub.selectById).toHaveBeenCalledWith(1);
        expect(userDbStub.insertOrUpdate).toHaveBeenCalledWith(1, 0);
        expect(historyDbStub.insert).toHaveBeenCalledWith(1, 100, TransactionType.USE, expect.any(Number));
        expect(result.point).toBe(0);
      });

      /**
       * id 인자가 양의 정수로 입력되지 않았을 경우 "올바르지 않은 ID 값 입니다." 라는 Error 를 반환하는지 확인
       * 실패 하였기 때문에 userDB, historyDB 에 저장하는 행위를 하지 않는지 확인
       */
      it("사용자의 ID 값을 양의 정수 형태로 주지 않을 경우 실패❌", async () => {
        await expect(pointService.usePoint(0, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.usePoint(-1, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.usePoint(1.5, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.usePoint(NaN, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");
        await expect(pointService.usePoint(Infinity, 100)).rejects.toThrow("올바르지 않은 ID 값 입니다.");

        expect(userDbStub.insertOrUpdate).not.toHaveBeenCalled();
        expect(historyDbStub.insert).not.toHaveBeenCalled();
      });

      /**
       * 사용할 액수를 양의 정수로 입력하지 않았을 경우 "충전할 포인트는 정수여야 하며 0보다 커야합니다." 라는 Error 를 반환하는지 확인
       * 실패 하였기 때문에 userDB, historyDB 에 저장하는 행위를 하지 않는지 확인
       */
      it("음수, 0, 실수, NaN, Infinity 값으로 포인트를 사용할 경우 실패❌", async () => {
        await expect(pointService.usePoint(1, -100)).rejects.toThrow("사용할 포인트는 정수여야 하며 0보다 커야합니다.");
        await expect(pointService.usePoint(1, 0)).rejects.toThrow("사용할 포인트는 정수여야 하며 0보다 커야합니다.");
        await expect(pointService.usePoint(1, 1.5)).rejects.toThrow("사용할 포인트는 정수여야 하며 0보다 커야합니다.");
        await expect(pointService.usePoint(1, NaN)).rejects.toThrow("사용할 포인트는 정수여야 하며 0보다 커야합니다.");
        await expect(pointService.usePoint(1, Infinity)).rejects.toThrow(
          "사용할 포인트는 정수여야 하며 0보다 커야합니다.",
        );

        expect(userDbStub.insertOrUpdate).not.toHaveBeenCalled();
        expect(historyDbStub.insert).not.toHaveBeenCalled();
      });

      /**
       * 자신이 가진 포인트 보다 많은 포인트를 사용하고자 할 때 "포인트가 부족합니다." 라는 Error 를 반환하는지 확인
       * 실패 하였기 때문에 userDB, historyDB 에 저장하는 행위를 하지 않는지 확인
       */
      it("100포인트가 있는 사용자1이 101포인트를 사용할 경우 실패❌", async () => {
        const mockUserPoint = { id: 1, point: 100, updateMillis: Date.now() };
        (userDbStub.selectById as jest.Mock).mockResolvedValue(mockUserPoint);

        await expect(pointService.usePoint(1, 101)).rejects.toThrow("포인트가 부족합니다.");

        expect(userDbStub.selectById).toHaveBeenCalledWith(1);
        expect(userDbStub.insertOrUpdate).not.toHaveBeenCalled();
        expect(historyDbStub.insert).not.toHaveBeenCalled();
      });
    });
  });
});
