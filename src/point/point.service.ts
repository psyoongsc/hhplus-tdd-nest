import { UserPointTable } from "../database/userpoint.table";
import { PointHistoryTable } from "../database/pointhistory.table";
import { Inject, Injectable } from "@nestjs/common";
import { PointHistory, TransactionType, UserPoint } from "./point.model";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class PointService {
  constructor(
    private readonly userDb: UserPointTable,
    private readonly historyDb: PointHistoryTable,
    private readonly config: ConfigService,
  ) {}

  private readonly chargeLimit: number = Number(this.config.get<string>("CHARGE_LIMIT", "100000"));

  // TODO - 특정 유저의 포인트를 조회하는 기능을 작성해주세요.
  async getPoint(userId: number): Promise<UserPoint> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("올바르지 않은 ID 값 입니다.");
    }

    return await this.userDb.selectById(userId);
  }

  // TODO - 특정 유저의 포인트 충전/이용 내역을 조회하는 기능을 작성해주세요.
  async getHistories(userId: number): Promise<PointHistory[]> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("올바르지 않은 ID 값 입니다.");
    }

    return await this.historyDb.selectAllByUserId(userId);
  }

  // TODO - 특정 유저의 포인트를 충전하는 기능을 작성해주세요.
  async chargePoint(userId: number, amount: number): Promise<UserPoint> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("올바르지 않은 ID 값 입니다.");
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error("충전할 포인트는 정수여야 하며 0보다 커야합니다.");
    }

    let updatedPoint;
    const userPoint = await this.userDb.selectById(userId);
    updatedPoint = userPoint.point + amount;

    // NOTE Module 에서 CHARGE_LIMIT 을 주입한 값을 사용한다.
    if (updatedPoint > this.chargeLimit) {
      throw new Error(`충전할 수 있는 최대 포인트는 ${this.chargeLimit} 입니다.`);
    }

    await this.userDb.insertOrUpdate(userId, updatedPoint);
    await this.historyDb.insert(userId, amount, TransactionType.CHARGE, Date.now());

    return { id: userId, point: updatedPoint, updateMillis: Date.now() };
  }

  // TODO - 특정 유저의 포인트를 사용하는 기능을 작성해주세요.
  async usePoint(userId: number, amount: number): Promise<UserPoint> {
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new Error("올바르지 않은 ID 값 입니다.");
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error("사용할 포인트는 정수여야 하며 0보다 커야합니다.");
    }

    let updatedPoint;
    const userPoint = await this.userDb.selectById(userId);
    updatedPoint = userPoint.point - amount;

    if (updatedPoint < 0) {
      throw new Error("포인트가 부족합니다.");
    }

    await this.userDb.insertOrUpdate(userId, updatedPoint);
    await this.historyDb.insert(userId, amount, TransactionType.USE, Date.now());

    return { id: userId, point: updatedPoint, updateMillis: Date.now() };
  }
}