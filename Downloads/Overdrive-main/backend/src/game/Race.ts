export class Car {
    id: string;
    ownerId?: string; // If undefined, it's an NPC
    name: string;
    speed: number;
    acceleration: number;
    luck: number;
    position: number = 0;
    
    // Status effects
    nitroBoostRemaining: number = 0;
    shieldRemaining: number = 0;
    riskShaftRemaining: number = 0;
    speedPenaltyRemaining: number = 0;
    speedPenaltyMultiplier: number = 1;

    // Ability use tracking
    nitroUsed: boolean = false;
    shieldUsed: boolean = false;
    riskUsed: boolean = false;
    collideUsed: boolean = false;
    
    constructor(id: string, name: string, isNpc: boolean) {
        this.id = id;
        this.name = name;
        this.speed = 50 + (Math.random() - 0.5) * 10;      // Base speed around a common mean
        this.acceleration = 11 + (Math.random() - 0.5) * 4; // Base acceleration with variance
        this.luck = Math.random();                          // Base luck 0-1
    }

    tick(deltaTimeMs: number) {
        // Base move calculation with per-tick variance for fairer races
        let currentSpeed = this.speed + (Math.random() - 0.5) * 20 * (0.4 + this.luck * 0.6);
        
        if (this.nitroBoostRemaining > 0) {
            currentSpeed *= 2;
            this.nitroBoostRemaining -= deltaTimeMs;
            if (this.nitroBoostRemaining <= 0) {
                this.nitroBoostRemaining = 0;
                this.nitroUsed = false;
            }
        }

        if (this.riskShaftRemaining > 0) {
            currentSpeed *= 3;
            this.riskShaftRemaining -= deltaTimeMs;
            if (this.riskShaftRemaining <= 0) {
                this.riskShaftRemaining = 0;
                this.riskUsed = false;
            }
        }

        if (this.speedPenaltyRemaining > 0) {
            currentSpeed *= this.speedPenaltyMultiplier;
            this.speedPenaltyRemaining -= deltaTimeMs;
            if (this.speedPenaltyRemaining <= 0) {
                this.speedPenaltyMultiplier = 1;
                this.speedPenaltyRemaining = 0;
                this.collideUsed = false;
            }
        }
        
        if (this.shieldRemaining > 0) {
            this.shieldRemaining -= deltaTimeMs;
            if (this.shieldRemaining <= 0) {
                this.shieldRemaining = 0;
                this.shieldUsed = false;
            }
        }

        // Apply acceleration based on luck and random variance
        const instantAccel = this.acceleration * (0.7 + Math.random() * 0.6) * (0.4 + this.luck * 0.6);
        this.position += (currentSpeed + instantAccel) * (deltaTimeMs / 1000);
    }
}

export class Race {
    id: string;
    trackLength: number = 4000;
    raceDurationMs: number = 180000;
    cars: Car[] = [];
    status: 'waiting' | 'starting' | 'active' | 'finished' = 'waiting';
    startTime: number = 0;
    startCountdownAt: number = 0;
    bettingPool: Record<string, { userId: string, amount: number, carId: string, bettorName?: string }[]> = {}; // carId -> bets
    bettorNames: Record<string, string> = {}; // userId -> bettor name

    constructor(id: string) {
        this.id = id;
        // spawn NPCs
        for (let i = 0; i < 3; i++) {
            this.cars.push(new Car(`npc_${i}`, `NPC Racer ${i+1}`, true));
        }
    }

    addPlayer(userId: string, username: string = 'Player') {
        // limit 3 real players for a 6 car race
        if (this.cars.filter(c => c.ownerId !== undefined).length < 3) {
            const car = new Car(userId, username, false);
            car.ownerId = userId;
            this.cars.push(car);
            return true;
        }
        return false;
    }

    placeBet(userId: string, amount: number, carId: string, bettorName?: string) {
        if (!this.bettingPool[carId]) {
            this.bettingPool[carId] = [];
        }
        const bet: any = { userId, amount, carId };
        if (bettorName !== undefined) {
            bet.bettorName = bettorName;
        }
        this.bettingPool[carId].push(bet);
        if (bettorName) {
            this.bettorNames[userId] = bettorName;
        }
    }

    start() {
        if (this.status !== 'waiting') return;
        this.status = 'starting';
        this.startCountdownAt = Date.now();
        
        setTimeout(() => {
            this.status = 'active';
            this.startTime = Date.now();
        }, 5000); // 5 sec countdown
    }

    tick(deltaTimeMs: number) {
        if (this.status !== 'active') return;

        let raceFinished = false;

        // Apply random events with small probability
        if (Math.random() < 0.1) { // 10% chance per tick to have a global event
            this.triggerRandomEvent();
        }

        this.cars.forEach(car => {
            car.tick(deltaTimeMs);
            if (car.position >= this.trackLength) {
                raceFinished = true;
            }
        });

        if (!raceFinished && Date.now() - this.startTime >= this.raceDurationMs) {
            raceFinished = true;
        }

        if (raceFinished) {
            this.status = 'finished';
        }
    }

    triggerRandomEvent() {
        const eventType = Math.floor(Math.random() * 3);
        const randomCar = this.cars[Math.floor(Math.random() * this.cars.length)];
        if (!randomCar) return;
        
        // Don't negatively affect shielded cars
        if (randomCar.shieldRemaining > 0 && (eventType === 0 || eventType === 1)) {
            return;
        }

        switch(eventType) {
            case 0: // Police
                randomCar.position -= 30; // slowdown
                break;
            case 1: // Mechanical issue
                randomCar.speed *= 0.9; // permanent slow for the rest of the race
                break;
            case 2: // Sudden boost
                randomCar.position += 50; 
                break;
        }
    }

    private findCollisionTarget(source: Car) {
        const opponents = this.cars.filter(c => c.id !== source.id);
        if (opponents.length === 0) return null;
        opponents.sort((a, b) => Math.abs(a.position - source.position) - Math.abs(b.position - source.position));
        return opponents[0];
    }

    useAbility(userId: string, ability: string, targetId?: string) {
        const car = this.cars.find(c => c.ownerId === userId);
        if (!car) return { success: false, message: 'You are not driving a racer.' };
        if (this.status !== 'active') return { success: false, message: 'Abilities can only be used during an active race.' };

        if (ability === 'nitro') {
            if (car.nitroBoostRemaining > 0) return { success: false, message: 'Nitro Boost is already active.' };
            car.nitroUsed = true;
            car.nitroBoostRemaining = 15000;
            return { success: true, message: 'Nitro Boost is now being used, your speed is now 2x for 15 seconds!' };
        }

        if (ability === 'risk') {
            if (car.riskShaftRemaining > 0) return { success: false, message: 'Risk Shaft is already active.' };
            car.riskUsed = true;
            car.riskShaftRemaining = 15000;
            return { success: true, message: 'Risk Shaft is now being used, your speed is now 3x for 15 seconds!' };
        }

        if (ability === 'shield') {
            if (car.shieldRemaining > 0) return { success: false, message: 'Safety Shield is already active.' };
            car.shieldUsed = true;
            car.shieldRemaining = 30000;
            return { success: true, message: 'Safety Shield is now being used, you are protected for 30 seconds!' };
        }

        if (ability === 'collide') {
            if (car.speedPenaltyRemaining > 0) return { success: false, message: 'Wait for the collide penalty to end before using it again.' };
            car.collideUsed = true;
            car.speedPenaltyMultiplier = 0.75;
            car.speedPenaltyRemaining = 5000;
            let target = targetId ? this.cars.find(c => c.id === targetId && c.id !== car.id) : null;
            if (!target) {
                target = this.findCollisionTarget(car);
            }
            if (!target) {
                return { success: false, message: 'No valid target available for collide.' };
            }
            if (target.shieldRemaining > 0) {
                return { success: true, message: `Collide is now being used on ${target.name}, but Safety Shield held. You still lost speed.` };
            }
            const penalty = target.riskShaftRemaining > 0 ? 0.25 : 0.5;
            target.speedPenaltyMultiplier = penalty;
            target.speedPenaltyRemaining = 5000;
            return { success: true, message: `Collide is now being used on ${target.name}! Their speed is reduced.` };
        }

        return { success: false, message: 'Unknown ability.' };
    }

    getWinner() {
        if (this.status !== 'finished') return null;
        return this.cars.reduce((prev, current) => (prev.position > current.position) ? prev : current);
    }
}
