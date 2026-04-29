import * as THREE from 'three';
import { Player } from './Player';

export class WeatherSystem {
    private scene: THREE.Scene;
    private player: Player;

    // Time
    public timeOfDay: number = 12; // Start at noon
    private timeSpeed: number = 0.5; // Hours per real-time second

    // Lights & Sky
    private dirLight: THREE.DirectionalLight;
    private ambientLight: THREE.AmbientLight;

    // Weather
    public isRaining: boolean = false;
    private rainParticles?: THREE.Points;
    private rainGeo?: THREE.BufferGeometry;
    private rainCount: number = 10000;

    // Weather cycle
    private weatherTimer: number = 0;

    constructor(scene: THREE.Scene, player: Player, dirLight: THREE.DirectionalLight, ambientLight: THREE.AmbientLight) {
        this.scene = scene;
        this.player = player;
        this.dirLight = dirLight;
        this.ambientLight = ambientLight;
        this.initRain();

        // Initial fog setup
        if (!(this.scene.fog instanceof THREE.FogExp2)) {
            this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.005);
        }
    }

    private initRain() {
        this.rainGeo = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(this.rainCount * 3);

        for (let i = 0; i < this.rainCount; i++) {
            rainPositions[i*3] = Math.random() * 400 - 200;
            rainPositions[i*3+1] = Math.random() * 200;
            rainPositions[i*3+2] = Math.random() * 400 - 200;
        }

        this.rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));

        const rainMaterial = new THREE.PointsMaterial({
            color: 0xaaaaaa,
            size: 0.5,
            transparent: true,
            opacity: 0.6
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

        if (isNight) {
            this.ambientLight.intensity = 0.2;
            this.dirLight.intensity = 0.1;
            this.scene.background = new THREE.Color(0x0a0a1a);

            if (this.scene.fog instanceof THREE.FogExp2) {
                this.scene.fog.color.setHex(0x0a0a1a);
                // Denser fog at night
                this.scene.fog.density = 0.01 / (cameraDistance * 0.1 || 1);
            }
        } else {
            const intensity = Math.sin(timeRad);
            this.ambientLight.intensity = 0.4 + (intensity * 0.4);
            this.dirLight.intensity = 0.5 + (intensity * 0.5);

            const skyColor = new THREE.Color().lerpColors(
                new THREE.Color(0xff8c00), // Dawn/Dusk orange
                new THREE.Color(0x87CEEB), // Noon sky blue
                Math.abs(intensity)
            );
            this.scene.background = skyColor;

            if (this.scene.fog instanceof THREE.FogExp2) {
                this.scene.fog.color.copy(skyColor);
                // Adjust fog density based on camera distance to always hide the far planes
                this.scene.fog.density = 0.003 / (cameraDistance * 0.1 || 1);
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
                this.player.friction = 0.98;
            } else {
                this.scene.remove(this.rainParticles!);
                this.player.friction = 0.95;
            }
        }

        if (this.isRaining && this.rainParticles && this.rainGeo) {
            this.rainParticles.position.x = this.player.mesh.position.x;
            this.rainParticles.position.z = this.player.mesh.position.z;

            const positions = this.rainGeo.attributes.position.array as Float32Array;
            for (let i = 0; i < this.rainCount; i++) {
                positions[i*3+1] -= 80 * deltaTime;
                if (positions[i*3+1] < 0) {
                    positions[i*3+1] = 200;
                }
            }
            this.rainGeo.attributes.position.needsUpdate = true;
        }
    }
}
