export class Car {
    id;
    ownerId; // If undefined, it's an NPC
    name;
    speed;
    acceleration;
    luck;
    position = 0;
    // Status effects
    nitroBoostRemaining = 0;
    shieldRemaining = 0;
    riskDriftActive = false;
    constructor(id, name, isNpc) {
        this.id = id;
        this.name = name;
        this.speed = 40 + Math.random() * 20; // Base speed
        this.acceleration = 10 + Math.random() * 5; // Base acceleration
        this.luck = Math.random(); // Base luck 0-1
    }
    tick(deltaTimeMs) {
        // Base move calculation
        let currentSpeed = this.speed;
        if (this.nitroBoostRemaining > 0) {
            currentSpeed += 50;
            this.nitroBoostRemaining -= deltaTimeMs;
        }
        if (this.riskDriftActive) {
            // High risk, high reward. Can give huge boost or slow down
            const driftEffect = Math.random() > 0.5 ? 80 : -40;
            currentSpeed += driftEffect;
            // Risk drift only lasts for one tick when activated
            this.riskDriftActive = false;
        }
        if (this.shieldRemaining > 0) {
            this.shieldRemaining -= deltaTimeMs;
        }
        // Apply acceleration based on luck and random variance
        const instantAccel = this.acceleration * (0.8 + Math.random() * 0.4) * (this.luck * 0.5 + 0.5);
        this.position += (currentSpeed + instantAccel) * (deltaTimeMs / 1000);
    }
}
export class Race {
    id;
    trackLength = 4000;
    cars = [];
    status = 'waiting';
    startTime = 0;
    bettingPool = {}; // carId -> bets
    constructor(id) {
        this.id = id;
        // spawn NPCs
        for (let i = 0; i < 3; i++) {
            this.cars.push(new Car(`npc_${i}`, `NPC Racer ${i + 1}`, true));
        }
    }
    addPlayer(userId, username = 'Player') {
        // limit 3 real players for a 6 car race
        if (this.cars.filter(c => c.ownerId !== undefined).length < 3) {
            const car = new Car(userId, username, false);
            car.ownerId = userId;
            this.cars.push(car);
            return true;
        }
        return false;
    }
    placeBet(userId, amount, carId) {
        if (!this.bettingPool[carId]) {
            this.bettingPool[carId] = [];
        }
        this.bettingPool[carId].push({ userId, amount, carId });
    }
    start() {
        if (this.status !== 'waiting')
            return;
        this.status = 'starting';
        setTimeout(() => {
            this.status = 'active';
            this.startTime = Date.now();
        }, 5000); // 5 sec countdown
    }
    tick(deltaTimeMs) {
        if (this.status !== 'active')
            return;
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
        if (raceFinished) {
            this.status = 'finished';
        }
    }
    triggerRandomEvent() {
        const eventType = Math.floor(Math.random() * 3);
        const randomCar = this.cars[Math.floor(Math.random() * this.cars.length)];
        if (!randomCar)
            return;
        // Don't negatively affect shielded cars
        if (randomCar.shieldRemaining > 0 && (eventType === 0 || eventType === 1)) {
            return;
        }
        switch (eventType) {
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
    getWinner() {
        if (this.status !== 'finished')
            return null;
        return this.cars.reduce((prev, current) => (prev.position > current.position) ? prev : current);
    }
}
//# sourceMappingURL=Race.js.map