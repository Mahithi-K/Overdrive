export declare class Car {
    id: string;
    ownerId?: string;
    name: string;
    speed: number;
    acceleration: number;
    luck: number;
    position: number;
    nitroBoostRemaining: number;
    shieldRemaining: number;
    riskDriftActive: boolean;
    constructor(id: string, name: string, isNpc: boolean);
    tick(deltaTimeMs: number): void;
}
export declare class Race {
    id: string;
    trackLength: number;
    cars: Car[];
    status: 'waiting' | 'starting' | 'active' | 'finished';
    startTime: number;
    bettingPool: Record<string, {
        userId: string;
        amount: number;
        carId: string;
    }[]>;
    constructor(id: string);
    addPlayer(userId: string, username?: string): boolean;
    placeBet(userId: string, amount: number, carId: string): void;
    start(): void;
    tick(deltaTimeMs: number): void;
    triggerRandomEvent(): void;
    getWinner(): Car | null;
}
//# sourceMappingURL=Race.d.ts.map