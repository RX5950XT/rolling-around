import * as THREE from 'three';
import { Engine } from './Engine';
import { Player } from './Player';
import { WorldManager } from './WorldManager';
import { WeatherSystem } from './WeatherSystem';
import { AudioManager } from './AudioManager';

export class GameManager {
    public engine: Engine;
    public player: Player;
    public world: WorldManager;
    public weather: WeatherSystem;
    public audio: AudioManager;

    public isPaused: boolean = true;
    private disposed: boolean = false;
    private clock: THREE.Clock;

    private startScreen: HTMLElement;
    private pauseScreen: HTMLElement;
    private sizeVal: HTMLElement;

    constructor() {
        this.engine = new Engine();
        this.player = new Player(this.engine.scene);
        this.world = new WorldManager(this.engine.scene, this.player);
        this.weather = new WeatherSystem(this.engine.scene, this.player, this.engine.dirLight, this.engine.ambientLight);
        this.audio = new AudioManager();
        this.clock = new THREE.Clock();

        this.startScreen = document.getElementById('start-screen')!;
        this.pauseScreen = document.getElementById('pause-screen')!;
        this.sizeVal = document.getElementById('size-val')!;

        const startBtn = document.getElementById('start-btn')!;
        startBtn.addEventListener('click', () => this.startGame());

        const resumeBtn = document.getElementById('resume-btn')!;
        resumeBtn.addEventListener('click', () => this.togglePause());

        this.player.setJumpCallback(() => this.audio.playJumpSound());
        this.initControls();
        this.animate();
    }

    private initControls() {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Escape') {
                this.togglePause();
            }
        });

        this.engine.onPointerLockChange((isLocked) => {
            if (!isLocked && !this.isPaused && this.startScreen.classList.contains('hidden')) {
                this.pauseGame();
            }
        });
    }

    public startGame() {
        this.startScreen.classList.add('hidden');
        this.audio.init();
        this.isPaused = false;
        this.clock.start();
        this.engine.requestPointerLock();
    }

    public pauseGame() {
        if (!this.startScreen.classList.contains('hidden')) return;
        if (this.isPaused) return;

        this.isPaused = true;
        this.pauseScreen.classList.remove('hidden');
        this.clock.stop();
        this.audio.suspend();
        this.engine.exitPointerLock();
    }

    public resumeGame() {
        if (!this.startScreen.classList.contains('hidden')) return;
        if (!this.isPaused) return;

        this.isPaused = false;
        this.pauseScreen.classList.add('hidden');
        this.clock.start();
        this.audio.resume();
        this.engine.requestPointerLock();
    }

    public togglePause() {
        if (!this.startScreen.classList.contains('hidden')) return;

        if (this.isPaused) {
            this.resumeGame();
        } else {
            this.pauseGame();
        }
    }

    private updateUI() {
        this.sizeVal.innerText = this.player.size.toFixed(2);
    }

    // Reusable temp vector to avoid GC pressure
    private _collisionPushDir = new THREE.Vector3();

    private checkCollisions() {
        const playerPos = this.player.mesh.position;
        const playerRadius = this.player.size;
        const playerVol = this.player.volume;
        const toRemove: number[] = [];

        const pushDir = this._collisionPushDir;
        pushDir.set(0, 0, 0);
        let maxSeparation = 0;
        let collisionCount = 0;
        const MAX_COLLISIONS_PER_FRAME = 5;

        // Quick-reject radius: objects farther than this cannot possibly collide
        const quickRejectDist = playerRadius + 80;
        const quickRejectDistSq = quickRejectDist * quickRejectDist;

        for (let i = 0; i < this.world.collidables.length; i++) {
            if (collisionCount >= MAX_COLLISIONS_PER_FRAME) break;

            const obj = this.world.collidables[i];
            const objData = (obj as THREE.Object3D).userData;
            const cached = objData.cachedPos;
            if (!cached) continue;

            // Phase 1: cheap squared-distance pre-filter using cached position
            const dx = playerPos.x - cached.x;
            const dy = playerPos.y - cached.y;
            const dz = playerPos.z - cached.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            if (distSq > quickRejectDistSq) continue;

            // Phase 2: precise collision using actual radius
            const objRadius = objData.radius || 1;
            const collisionDistSq = (playerRadius + objRadius) * (playerRadius + objRadius);
            if (distSq >= collisionDistSq) continue;

            const objVol = objData.volume || 1;
            if (playerVol > objVol) {
                this.player.attachObject(obj);
                this.audio.playPopSound(this.player.size);
                toRemove.push(i);
            } else {
                const dist = Math.sqrt(distSq);
                if (dist < 0.001) {
                    pushDir.x += Math.random() - 0.5;
                    pushDir.z += Math.random() - 0.5;
                } else {
                    pushDir.x += dx / dist;
                    pushDir.z += dz / dist;
                }

                const separation = (playerRadius + objRadius) - dist + 0.2;
                if (separation > maxSeparation) {
                    maxSeparation = separation;
                }
                collisionCount++;
            }
        }

        if (collisionCount > 0) {
            const pushLenSq = pushDir.x * pushDir.x + pushDir.z * pushDir.z;
            if (pushLenSq > 0.001) {
                const pushLen = Math.sqrt(pushLenSq);
                pushDir.x /= pushLen;
                pushDir.z /= pushLen;
            } else {
                pushDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
            }

            const separation = maxSeparation + 0.5;
            this.player.mesh.position.x += pushDir.x * separation;
            this.player.mesh.position.y += pushDir.y * separation;
            this.player.mesh.position.z += pushDir.z * separation;

            const bounceForce = Math.min(
                Math.max(this.player.velocity.length() * 0.5, 4),
                8
            );
            this.player.velocity.copy(pushDir.multiplyScalar(bounceForce));
        }

        for (let i = toRemove.length - 1; i >= 0; i--) {
            const removedObj = this.world.collidables[toRemove[i]];
            this.world.collidables.splice(toRemove[i], 1);
            const movingIndex = this.world.movingEntities.indexOf(removedObj);
            if (movingIndex !== -1) {
                this.world.movingEntities.splice(movingIndex, 1);
            }
        }
    }

    public dispose() {
        this.disposed = true;
        this.engine.exitPointerLock();
    }

    private animate = () => {
        if (this.disposed) return;
        requestAnimationFrame(this.animate);

        if (!this.isPaused) {
            const delta = this.clock.getDelta();

            this.player.update(delta, this.engine.cameraAngle, (x, z) => this.world.getTerrainHeight(x, z));
            this.world.update(delta);
            this.checkCollisions();

            const cameraDist = this.engine.cameraDistance * this.player.size;
            this.weather.update(delta, cameraDist);

            const baseMaxSpeed = this.player.maxSpeed * Math.pow(this.player.size, 0.95);
            let multiplier = 1.0;
            if (this.player.size >= 200) multiplier = 100.0;
            else if (this.player.size >= 100) multiplier = 10.0;
            else if (this.player.size >= 50) multiplier = 5.0;
            const currentMaxSpeed = baseMaxSpeed * multiplier;
            this.audio.updateRollingSound(this.player.velocity.length(), currentMaxSpeed, this.player.size);
            const isNight = this.weather.timeOfDay < 6 || this.weather.timeOfDay > 18;
            this.audio.updateAmbientSound(this.weather.isRaining, isNight);

            this.engine.updateCamera(
                this.player.mesh.position,
                this.player.size,
                delta,
                (x, z) => this.world.getTerrainHeight(x, z)
            );

            this.updateUI();
        }

        this.engine.renderer.render(this.engine.scene, this.engine.camera);
    };
}