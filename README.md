# 동시성 제어 방식 및 각 적용의 장/단점

# 1. 메모리 기반 락

요청이 들어왔을 때 해당 유저에 대한 락이 걸려있으면 기다리거나 거절하는 방식
처리중이면 다른 요청은 대기 or 실패로 처리한다.
처리가 끝나면 락을 해제하고 다음 요청이 락을 가져간다.

메모리 기반 락 방식은 NestJS 인스턴스가 1개일 때만 안전하기에 다중 인스턴스 환경에서는 사용에 주의해야 함.
너무 많은 락을 동시에 돌리면 busy wait 으로 CPU 사용량이 증가할 수 있기 때문에 제대로 await 을 통한 sleep 을 해주어야 한다.

해당 구조에 타임아웃, 락 싪패 시 fallback, 큐잉 방식으로도 확장 가능

```jsx
// 간단한 구현 예제, 처리중이면 다른 요청을 대기하게 함

const locks = new Map<string, boolean>();

async function runWithLock(key: string, fn: () => Promise<void>) {
  while (locks.get(key)) {
    // 이미 락이 걸려 있으면 10ms 대기 (busy wait)
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  locks.set(key, true);
  try {
    await fn(); // 보호할 로직 실행
  } finally {
    locks.set(key, false); // 락 해제
  }
}
```

```jsx
// 서비스에 적용할 수 있는 형태

@Injectable()
export class PointService {
  private locks = new Map<string, boolean>();
  private store = new Map<number, number>(); // userId -> point

  private async runWithLock(key: string, fn: () => Promise<void>) {
    while (this.locks.get(key)) {
      await new Promise((res) => setTimeout(res, 10));
    }

    this.locks.set(key, true);
    try {
      await fn();
    } finally {
      this.locks.set(key, false);
    }
  }

  async chargePoint(userId: number, amount: number) {
    await this.runWithLock(`user:${userId}`, async () => {
      const current = this.store.get(userId) || 0;
      const next = current + amount;

      // (예시) 충전 한도 제한
      const CHARGE_LIMIT = 10000;
      if (next > CHARGE_LIMIT) {
        throw new Error('충전 한도 초과');
      }

      this.store.set(userId, next);
    });
  }

  getPoint(userId: number) {
    return this.store.get(userId) || 0;
  }
}

```

```jsx
// 동시 요청 코드

await Promise.all([
  pointService.chargePoint(1, 3000),
  pointService.chargePoint(1, 4000),
  pointService.chargePoint(1, 5000), // 이건 실패해야 할 수도 있음
]);
```

# 2. Mutex, Semaphore 사용

async-mutex 라이브러리를 설치하여 기능에 적용 가능

병렬 요청을 제한 하려면 mutex, 병렬 허용하되 제한하려면 semaphore를 사용한다.

mutex 를 사용하면서 비동기적으로 요청들이 모두 잘 처리되기 위해서는 mutex 내부에는 반드시 await 을 사용하는 비동기 코드만 있어야 한다. → 단일 스레드로 실행하기 때문

```jsx
// 간단한 예시

import { Mutex } from 'async-mutex';

const mutex = new Mutex();

await mutex.runExclusive(async () => {
  // 여기서 코드는 오직 한 번에 하나만 실행됨
});
```

```jsx
// 유저 단위로 Mutex 적용

@Injectable()
export class PointService {
  private store = new Map<number, number>();
  private locks = new Map<number, Mutex>();

  private getMutexForUser(userId: number): Mutex {
    if (!this.locks.has(userId)) {
      this.locks.set(userId, new Mutex());
    }
    return this.locks.get(userId)!;
  }

  async chargePoint(userId: number, amount: number) {
    const mutex = this.getMutexForUser(userId);
    await mutex.runExclusive(async () => {
      const current = this.store.get(userId) || 0;
      const next = current + amount;

      if (next > 10000) throw new Error('충전 한도 초과');

      this.store.set(userId, next);
    });
  }
}
```

```jsx
// semaphore 도 지원함

import { Semaphore } from 'async-mutex';

const semaphore = new Semaphore(3); // 동시에 3개까지 허용

await semaphore.runExclusive(async () => {
  // 동시에 최대 3개까지 실행 가능
});
```

# 3. 작업 큐

요청을 바로 처리하지 않고 큐에 넣고, 한 번에 하나씩 처리하는 방식

Mutex 처럼 즉시 락을 걸지는 않지만, 순차적으로 처리 됨

Queue 에 대한 서비스를 직접 구현해야 한다면 구현 난이도가 높아짐

```jsx
// task-queue.service.ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';

type Task = () => Promise<void>;

@Injectable()
export class TaskQueueService implements OnModuleDestroy {
  private queue: Task[] = [];
  private concurrency = 2; // 동시에 처리할 작업 수
  private running = 0;
  private isDestroyed = false;

  async add(task: Task) {
    this.queue.push(task);
    this.processQueue();
  }

  private async processQueue() {
    if (this.running >= this.concurrency || this.queue.length === 0 || this.isDestroyed) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this.running++;
    try {
      await task();
    } catch (err) {
      console.error('작업 처리 중 오류 발생:', err);
    } finally {
      this.running--;
      this.processQueue(); // 다음 작업 처리
    }
  }

  onModuleDestroy() {
    this.isDestroyed = true;
  }
}
```

```jsx
// some.service.ts
import { Injectable } from '@nestjs/common';
import { TaskQueueService } from './task-queue.service';

@Injectable()
export class SomeService {
  constructor(private readonly taskQueueService: TaskQueueService) {}

  async doSomething() {
    await this.taskQueueService.add(async () => {
      console.log('작업 시작:', new Date().toISOString());
      await this.simulateHeavyWork();
      console.log('작업 끝:', new Date().toISOString());
    });
  }

  private async simulateHeavyWork() {
    // 예시: 3초간 처리되는 작업
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}
```

```jsx
// app.module.ts
import { Module } from '@nestjs/common';
import { TaskQueueService } from './task-queue.service';
import { SomeService } from './some.service';

@Module({
  providers: [TaskQueueService, SomeService],
})
export class AppModule {}
```

```jsx
// main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const someService = app.get(SomeService);

  // 테스트: 여러 작업을 동시에 추가
  for (let i = 0; i < 5; i++) {
    someService.doSomething();
  }

  await app.listen(3000);
}
```

# 4. Event Loop 기반의 순차 처리

요청들을 이벤트처럼 쌓아두고, 한 쓰레드에서 순서대로 처리

락은 없지만, 동시에 들어온 요청을 한 줄로 세움

```jsx
const queue: (() => Promise<void>)[] = [];
let running = false;

async function processQueue() {
  if (running) return;
  running = true;

  while (queue.length) {
    const task = queue.shift();
    if (task) await task();
  }

  running = false;
}
```

# 5. 변경 불가능한 상태 기반 처리 (Immutable State)

상태 자체를 매번 새로 만들어서 race condition 자체를 회피

React의 reducer 패턴처럼, 입력과 상태로 새로운 상태 계산

일반적 서버 환경에선 적합하지 않을 수도 있지만 간단한 경우엔 효과적

값을 직접 변경하는 방식은 사용하지 않음 (.point += 와 같은 방식)

또한 아래와 같은 코드로는 완전한 race condition 방지는 못함. mutex 와의 조합이 필요함

왜냐면 getUserState() → chargePoint() 사이에 다른 쓰레드가 상태를 바꿀 수 있음

```jsx
type UserState = {
  userId: number;
  point: number;
  version: number; // 변경 감지용
};

@Injectable()
export class PointService {
  private stateStore = new Map<number, UserState>();

  /**
   * 현재 상태 snapshot 조회 (read-only)
   */
  getUserState(userId: number): UserState {
    return this.stateStore.get(userId) || { userId, point: 0, version: 0 };
  }

  /**
   * 상태 변경 처리 (immutable 방식)
   */
  chargePoint(userId: number, chargeAmount: number): void {
    const prev = this.getUserState(userId);
    const nextPoint = prev.point + chargeAmount;

    const CHARGE_LIMIT = 10000;
    if (nextPoint > CHARGE_LIMIT) {
      throw new Error(`CHARGE_LIMIT ${CHARGE_LIMIT} 초과`);
    }

    // 상태를 직접 수정하지 않고, 복사본을 만들어 덮어씀
    const nextState: UserState = {
      ...prev,
      point: nextPoint,
      version: prev.version + 1,
    };

    this.stateStore.set(userId, nextState);
  }
}
```

# 6. Debounce / Throttle (요청 제어)

여러 요청이 짧은 시간 안에 몰려들 경우, 무시하거나 나중에 한 번만 처리

race condition 자체를 회피

race condition 을 막는다기 보다는 줄인다는 개념

요청이 너무 자주 들어오는 걸 제어해서, 중복 처리나 경쟁 상태를 완화하는 방식

실시간 충전 요청 같은 경우: Throttle → 과다 요청 방지

검색창 자동완성, 입력창 처리: Debounce → 마지막 입력만 처리

```jsx
// lodash 예시
debounce(() => doSomething(), 100);
```

```jsx
// Debount 예제

@Injectable()
export class PointService {
  private store = new Map<number, number>();

  private debounceMap = new Map<number, () => void>();

  chargePoint(userId: number, amount: number) {
    if (!this.debounceMap.has(userId)) {
      const fn = debounce(() => {
        const current = this.store.get(userId) || 0;
        this.store.set(userId, current + amount);
        console.log(`[DEBOUNCED] user ${userId} 포인트 충전 완료`);
      }, 500); // 500ms 안에 또 호출되면 대기

      this.debounceMap.set(userId, fn);
    }

    this.debounceMap.get(userId)!();
  }
}
```

```jsx
// Throttle 예제

@Injectable()
export class PointService {
  private store = new Map<number, number>();

  private throttleMap = new Map<number, () => void>();

  chargePoint(userId: number, amount: number) {
    if (!this.throttleMap.has(userId)) {
      const fn = throttle(() => {
        const current = this.store.get(userId) || 0;
        this.store.set(userId, current + amount);
        console.log(`[THROTTLED] user ${userId} 포인트 충전`);
      }, 1000); // 1초에 한 번만 실행

      this.throttleMap.set(userId, fn);
    }

    this.throttleMap.get(userId)!();
  }
}
```

# 7. 버퍼링 & 배치 처리

일정 시간 또는 개수만큼 요청을 모았다가 한꺼번에 처리

데이터 정합성을 컨트롤하는 쪽에 무게를 두는 방식

주로 성능 최적화, 요청 빈도 조절, 그리고 DB 같은 외부 자원에 대한 접근을 줄이기 위해 많이 사용됨

```jsx
interface ChargeRequest {
  userId: number;
  amount: number;
}

@Injectable()
export class PointService {
  private store = new Map<number, number>();
  private buffer: ChargeRequest[] = [];
  private readonly BATCH_INTERVAL = 1000; // 1초마다 처리

  constructor() {
    // 1초마다 버퍼 처리
    setInterval(() => this.flushBuffer(), this.BATCH_INTERVAL);
  }

  /**
   * 외부에서 호출하는 함수: 버퍼에 충전 요청 추가
   */
  chargePoint(userId: number, amount: number) {
    this.buffer.push({ userId, amount });
  }

  /**
   * 주기적으로 버퍼에 쌓인 요청을 처리
   */
  private flushBuffer() {
    if (this.buffer.length === 0) return;

    console.log(`[Batch] Processing ${this.buffer.length} requests...`);

    const grouped = new Map<number, number>();

    // 유저별로 합산
    for (const { userId, amount } of this.buffer) {
      grouped.set(userId, (grouped.get(userId) || 0) + amount);
    }

    // 포인트 누적 적용
    for (const [userId, totalAmount] of grouped.entries()) {
      const current = this.store.get(userId) || 0;
      const updated = current + totalAmount;

      // 예: 최대 포인트 제한
      const CHARGE_LIMIT = 10000;
      if (updated > CHARGE_LIMIT) {
        console.warn(`[Batch] user:${userId} 충전 한도 초과 (요청 무시됨)`);
        continue;
      }

      this.store.set(userId, updated);
      console.log(`[Batch] user:${userId}, +${totalAmount} → ${updated}`);
    }

    // 버퍼 초기화
    this.buffer = [];
  }

  getPoint(userId: number): number {
    return this.store.get(userId) || 0;
  }
}
```

# 8. CAS 패턴 (Compare and Swap) - 낙관적 처리

상태가 바뀌지 않았을 때만 반영 (낙관적 락과 유사)

메모리 기반에서는 어렵지만, 상태 객체에 버전이나 timestamp를 넣고 비교하는 식으로 흉내 가능

```jsx
type UserState = {
  userId: number;
  point: number;
  version: number;
};

--------------------------------------------

@Injectable()
export class PointService {
  private store = new Map<number, UserState>();

  private getState(userId: number): UserState {
    return (
      this.store.get(userId) ?? {
        userId,
        point: 0,
        version: 1,
      }
    );
  }

  /**
   * CAS 방식으로 포인트 충전
   */
  async chargePointCAS(userId: number, amount: number): Promise<void> {
    const MAX_RETRIES = 3;
    const CHARGE_LIMIT = 10000;

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      const current = this.getState(userId);
      const newPoint = current.point + amount;

      if (newPoint > CHARGE_LIMIT) {
        throw new Error(`user:${userId} 충전 한도 초과 (${newPoint} > ${CHARGE_LIMIT})`);
      }

      const nextState: UserState = {
        userId,
        point: newPoint,
        version: current.version + 1,
      };

      // 현재 상태가 그대로일 때만 업데이트
      const latest = this.store.get(userId);
      if (!latest || latest.version === current.version) {
        this.store.set(userId, nextState);
        console.log(`[CAS] 충전 성공 - user:${userId}, point: ${newPoint}`);
        return;
      }

      console.warn(`[CAS] 충돌 감지 - user:${userId}, 재시도 ${retry + 1}`);
      await new Promise((res) => setTimeout(res, 10)); // 짧은 대기 후 재시도
    }

    throw new Error(`[CAS] user:${userId} 충전 실패 - 충돌 반복`);
  }

  getPoint(userId: number): number {
    return this.store.get(userId)?.point || 0;
  }
}
```

# Race Condition 대응 전략 비교 표

| 방법 | 개념 | 동시성 제어 단위 | 장점 | 단점 | 추천 상황 |
| --- | --- | --- | --- | --- | --- |
| 메모리 기반 락 | Map + boolean flag 로 락 직접 구현 | 키 단위 | 간단, 외부 의존 없음 | 직접 구현 필요, 실수 여지 많음 | 단일 인스턴스, 빠른 대응 필요할 때 |
| Mutex | 한번에 하나만 실행 (lock & unlock) | 리소스 단위 | 안정적, 안전한 API | 락 체인 관리 필요 | 순차 실행이 중요한 동작 |
| Semaphore | 동시에 N개만 실행 허용 | 전체 또는 그룹 단위 | 병렬 처리 + 제한 가능 | 너무 많으면 관리 어려움 | 제한된 동시 처리 허용 시 |
| 작업 큐(Queue) | 요청을 순서대로 대기 처리 | 유저 or 리소스 단위 | 락 없이 순서 보장 | 큐 누적 시 지연 | 빠른 락보다 정확한 순서가 중요할 때 |
| Event Loop 직렬화 | 단위 로프로 순차 실행 | 전체 작업 | 코드 단순화 | 병렬처리 불가 | 작은 프로젝트, 전체 순서만 중요할 때 |
| 불변 상태 처리 | 상태를 매번 새로 만듦 | 상태 단위 | side-effect 없음 | 구조 변경 필요 | 데이터 정합성 설계 기반일 때 |
| Debounce / Throttle | 요청 간 간격 제어 | 요청 타이밍 | 구현 간단 | 정확한 동기화 불가 | 입력 중복/빈도 제어 목적일 때 |
| 배치 처리 | 일정 시간마다 모아 처리 | 전체 or 키 단위 | 성능 향상, DB 부담 감소 | 실시간성 낮음 | 비실시간 대량 처리 |
| CAS 패턴 | 이전 상태 기준으로 업데이트 조건 비교 | 객체 단위 | 락 없이도 충돌 감지 | 충돌 시 재시도 필요 | 고성능 낙관적 처리 설계 시 |

# Race Condition 방지 전략 - 적용 난이도 평가

| 방법 | 난이도 | 이유 / 설명 |
| --- | --- | --- |
| 메모리 기반 락 | 하 | 아주 단순한 구조, 직접 구현 가능, 테스트하기 쉬움 |
| Mutex | 중 | 라이브러리 의존 필요, 락 해제 누락 방지 필요 |
| Semaphore | 중 | 기본은 쉬우나 제한값/실패처리 등 설계 필요 |
| 작업 큐 | 중~상 | 큐 관리 구조 필요, 비동기 흐름 제어 경험 요구 |
| Event Loop | 하~중 | 간단하지만 병렬 처리 불가, 글로벌 큐만 가능 |
| Immutable 상태 처리 | 상 | 아키텍처 설계 수준의 변화 필요, 상태 관리 철저히 |
| Debounce / Throttle | 하 | 라이브러리 있음, 타이밍 제어만 필요 |
| 배치 처리 | 중 | 구현은 쉬우나 타이밍/처리 타켓 정의 필요 |
| CAS 패턴 | 상 | 충돌 감지 및 재시도 구조 필요, 명확한 버전 관리 필요 |

# 시나리오 별 추천 방식

| 시나리오 | 추천 방식 |
| --- | --- |
| 단일 NestJS 인스턴스, in-memory 사용 | ✅메모리 락 / Mutex |
| 하나의 요청만 처리되면 되는 리소스 | Mutex |
| 동시에 N개만 허용하고 싶을 때 | Semaphore |
| 정확한 수서만 중요하고 병렬성 불필요 | ✅작업 큐 |
| 상태가 예측 가능한 방식으로만 변경된다면 | Immutable / CAS |
| 단순 중복 요청 방지 | Debounce / Throttle |