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
    private clock: THREE.Clock;

    // UI elements
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

        // Setup UI
        this.startScreen = document.getElementById('start-screen')!;
        this.pauseScreen = document.getElementById('pause-screen')!;
        this.sizeVal = document.getElementById('size-val')!;

        const startBtn = document.getElementById('start-btn')!;
        startBtn.addEventListener('click', () => this.startGame());

        this.initControls();

        // Start animation loop
        this.animate();
    }

    private initControls() {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Escape') {
                this.togglePause();
            }
        });
    }

    public startGame() {
        this.startScreen.classList.add('hidden');
        this.audio.init(); // Initialize audio context on user interaction
        this.isPaused = false;
        this.clock.start();
    }

    public togglePause() {
        if (!this.startScreen.classList.contains('hidden')) return;

        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            this.pauseScreen.classList.remove('hidden');
            this.clock.stop();
            // mute rolling sound when paused
            this.audio.updateRollingSound(0, 1, 1);
        } else {
            this.pauseScreen.classList.add('hidden');
            this.clock.start();
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

        for (let i = 0; i < this.world.collidables.length; i++) {
            const obj = this.world.collidables[i];
            const objPos = new THREE.Vector3();
            obj.getWorldPosition(objPos);

            const distSq = playerPos.distanceToSquared(objPos);

            const objRadius = (obj as any).userData.radius || 1;
            const collisionDistSq = Math.pow(playerRadius + objRadius, 2);

            if (distSq < collisionDistSq) {
                const objVol = (obj as any).userData.volume || 1;

                if (playerVol > objVol) {
                    this.player.attachObject(obj);
                    this.audio.playPopSound(this.player.size);
                    toRemove.push(i);
                } else {
                    const bounceDir = new THREE.Vector3().subVectors(playerPos, objPos).normalize();
                    const bounceForce = this.player.velocity.length() * 0.5 + 2;
                    this.player.velocity.copy(bounceDir.multiplyScalar(bounceForce));
                    break;
                }
            }
        }

        for (let i = toRemove.length - 1; i >= 0; i--) {
            this.world.collidables.splice(toRemove[i], 1);
        }
    }

    private animate = () => {
        requestAnimationFrame(this.animate);

        if (!this.isPaused) {
            const delta = this.clock.getDelta();

            this.player.update(delta, this.engine.cameraAngle);
            this.world.update();
            this.checkCollisions();

            const cameraDist = this.engine.cameraDistance * this.player.size;
            this.weather.update(delta, cameraDist);

            // Audio updates
            const currentMaxSpeed = this.player.maxSpeed * Math.sqrt(this.player.size);
            this.audio.updateRollingSound(this.player.velocity.length(), currentMaxSpeed, this.player.size);
            const isNight = this.weather.timeOfDay < 6 || this.weather.timeOfDay > 18;
            this.audio.updateAmbientSound(this.weather.isRaining, isNight);

            this.engine.updateCamera(this.player.mesh.position, this.player.size, delta);

            this.updateUI();
        }

        this.engine.renderer.render(this.engine.scene, this.engine.camera);
    }
}
