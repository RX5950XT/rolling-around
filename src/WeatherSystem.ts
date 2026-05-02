import * as THREE from 'three';
import { Player } from './Player';

export class WeatherSystem {
    private scene: THREE.Scene;
    private player: Player;

    public timeOfDay: number = 12;
    private timeSpeed: number = 0.5;

    private dirLight: THREE.DirectionalLight;
    private ambientLight: THREE.AmbientLight;

    public isRaining: boolean = false;
    private rainParticles?: THREE.Points;
    private rainGeo?: THREE.BufferGeometry;
    private rainCount: number = 500;

    private weatherTimer: number = 0;

    constructor(scene: THREE.Scene, player: Player, dirLight: THREE.DirectionalLight, ambientLight: THREE.AmbientLight) {
        this.scene = scene;
        this.player = player;
        this.dirLight = dirLight;
        this.ambientLight = ambientLight;
        this.initRain();

        if (!(this.scene.fog instanceof THREE.FogExp2)) {
            this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);
        }
    }

    private initRain() {
        this.rainGeo = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(this.rainCount * 3);

        for (let i = 0; i < this.rainCount; i++) {
            rainPositions[i * 3] = Math.random() * 200 - 100;
            rainPositions[i * 3 + 1] = Math.random() * 100;
            rainPositions[i * 3 + 2] = Math.random() * 200 - 100;
        }

        this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));

        const rainMaterial = new THREE.PointsMaterial({
            color: 0xaaaaaa,
            size: 0.3,
            transparent: true,
            opacity: 0.5
        });

        this.rainParticles = new THREE.Points(this.rainGeo, rainMaterial);
    }

    public update(deltaTime: number, cameraDistance: number) {
        this.timeOfDay += this.timeSpeed * deltaTime;
        if (this.timeOfDay >= 24) this.timeOfDay -= 24;

        this.updateTimeVisuals(cameraDistance);
        this.updateWeather(deltaTime);
    }

    private updateTimeVisuals(cameraDistance: number) {
        const timeRad = ((this.timeOfDay - 6) / 24) * Math.PI * 2;

        this.dirLight.position.x = Math.cos(timeRad) * 200;
        this.dirLight.position.y = Math.sin(timeRad) * 200;
        this.dirLight.position.z = Math.sin(timeRad) * 100;

        const isNight = this.timeOfDay < 6 || this.timeOfDay > 18;

        // Scale fog visibility with player size so large players don't see void
        const sizeFactor = 1 / (1 + this.player.size * 0.005);

        if (isNight) {
            this.ambientLight.intensity = 0.2;
            this.dirLight.intensity = 0.1;
            this.scene.background = new THREE.Color(0x0a0a1a);

            if (this.scene.fog instanceof THREE.FogExp2) {
                this.scene.fog.color.setHex(0x0a0a1a);
                this.scene.fog.density = (0.012 * sizeFactor) / (cameraDistance * 0.1 || 1);
            }
        } else {
            const intensity = Math.sin(timeRad);
            this.ambientLight.intensity = 0.4 + (intensity * 0.4);
            this.dirLight.intensity = 0.5 + (intensity * 0.5);

            const skyColor = new THREE.Color().lerpColors(
                new THREE.Color(0xff8c00),
                new THREE.Color(0x87CEEB),
                Math.abs(intensity)
            );
            this.scene.background = skyColor;

            if (this.scene.fog instanceof THREE.FogExp2) {
                this.scene.fog.color.copy(skyColor);
                this.scene.fog.density = (0.005 * sizeFactor) / (cameraDistance * 0.1 || 1);
            }
        }
    }

    private updateWeather(deltaTime: number) {
        this.weatherTimer += deltaTime;

        if (this.weatherTimer > 40) {
            this.weatherTimer = 0;
            this.isRaining = Math.random() > 0.75;

            if (this.isRaining) {
                this.scene.add(this.rainParticles!);
                this.player.weatherFrictionModifier = 6.5;
            } else {
                this.scene.remove(this.rainParticles!);
                this.player.weatherFrictionModifier = 0.15;
            }
        }

        if (this.isRaining && this.rainParticles && this.rainGeo) {
            this.rainParticles.position.x = this.player.mesh.position.x;
            this.rainParticles.position.z = this.player.mesh.position.z;

            const positions = this.rainGeo.attributes.position.array as Float32Array;
            for (let i = 0; i < this.rainCount; i++) {
                positions[i * 3 + 1] -= 80 * deltaTime;
                if (positions[i * 3 + 1] < 0) {
                    positions[i * 3 + 1] = 100;
                }
            }
            this.rainGeo.attributes.position.needsUpdate = true;
        }
    }
}