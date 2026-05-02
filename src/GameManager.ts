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

        this.initControls();
        this.animate();
    }

    private initControls() {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Escape') {
                this.pauseGame();
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

    private checkCollisions() {
        const playerPos = this.player.mesh.position;
        const playerRadius = this.player.size;
        const playerVol = this.player.volume;
        const toRemove: number[] = [];

        let pushDir = new THREE.Vector3();
        let maxSeparation = 0;
        let collisionCount = 0;
        const MAX_COLLISIONS_PER_FRAME = 5;

        for (let i = 0; i < this.world.collidables.length; i++) {
            if (collisionCount >= MAX_COLLISIONS_PER_FRAME) break;

            const obj = this.world.collidables[i];
            const objPos = new THREE.Vector3();
            obj.getWorldPosition(objPos);

            const distSq = playerPos.distanceToSquared(objPos);
            const objRadius = (obj as THREE.Object3D).userData.radius || 1;
            const collisionDistSq = Math.pow(playerRadius + objRadius, 2);

            if (distSq < collisionDistSq) {
                const objVol = (obj as THREE.Object3D).userData.volume || 1;
                if (playerVol > objVol) {
                    this.player.attachObject(obj);
                    this.audio.playPopSound(this.player.size);
                    toRemove.push(i);
                } else {
                    const dir = new THREE.Vector3().subVectors(playerPos, objPos);
                    dir.y = 0;
                    const dist = Math.sqrt(distSq);
                    if (dist < 0.001) {
                        dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
                    } else {
                        dir.normalize();
                    }

                    pushDir.add(dir);

                    const separation = (playerRadius + objRadius) - dist + 0.2;
                    if (separation > maxSeparation) {
                        maxSeparation = separation;
                    }
                    collisionCount++;
                }
            }
        }

        if (collisionCount > 0) {
            pushDir.normalize();

            const cappedSeparation = Math.min(maxSeparation, playerRadius * 1.5);
            this.player.mesh.position.add(pushDir.clone().multiplyScalar(cappedSeparation));

            const bounceForce = Math.min(
                Math.max(this.player.velocity.length() * 0.5, 2),
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

            const currentMaxSpeed = this.player.maxSpeed * Math.sqrt(this.player.size);
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