import * as THREE from 'three';
import { Player } from './Player';

export class WeatherSystem {
    private scene: THREE.Scene;
    private player: Player;

    // Time
    public timeOfDay: number = 0; // 0 to 24
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

        // Initial setup
        this.timeOfDay = 12; // Start at noon
        this.initRain();
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
        // don't add to scene yet
    }

    public update(deltaTime: number, cameraDistance: number) {
        // Time update
        this.timeOfDay += this.timeSpeed * deltaTime;
        if (this.timeOfDay >= 24) this.timeOfDay -= 24;

        this.updateTimeVisuals(cameraDistance);
        this.updateWeather(deltaTime);
    }

    private updateTimeVisuals(cameraDistance: number) {
        // Calculate sun position based on time (0 to 24)
        // 6AM = sunrise, 18PM (18) = sunset
        const timeRad = ((this.timeOfDay - 6) / 24) * Math.PI * 2;

        this.dirLight.position.x = Math.cos(timeRad) * 100;
        this.dirLight.position.y = Math.sin(timeRad) * 100;
        this.dirLight.position.z = Math.sin(timeRad) * 50;

        // Day/Night transitions
        const isNight = this.timeOfDay < 6 || this.timeOfDay > 18;

        if (isNight) {
            // Night
            this.ambientLight.intensity = 0.2;
            this.dirLight.intensity = 0.1;
            this.scene.background = new THREE.Color(0x050510);

            // Fog at night (closer visibility)
            if (this.scene.fog instanceof THREE.Fog) {
                this.scene.fog.color.setHex(0x050510);
                this.scene.fog.near = cameraDistance * 0.5;
                this.scene.fog.far = cameraDistance * 2.5; // Reduced visibility
            }
        } else {
            // Day
            const intensity = Math.sin(timeRad); // 0 at dawn/dusk, 1 at noon
            this.ambientLight.intensity = 0.4 + (intensity * 0.4);
            this.dirLight.intensity = 0.5 + (intensity * 0.5);

            // Sky color transition
            const skyColor = new THREE.Color().lerpColors(
                new THREE.Color(0xffaa55), // Dawn/Dusk orange
                new THREE.Color(0x87CEEB), // Noon blue
                Math.abs(intensity)
            );
            this.scene.background = skyColor;

            if (this.scene.fog instanceof THREE.Fog) {
                this.scene.fog.color.copy(skyColor);
                this.scene.fog.near = cameraDistance;
                this.scene.fog.far = cameraDistance * 5; // Normal visibility
            }
        }
    }

    private updateWeather(deltaTime: number) {
        this.weatherTimer += deltaTime;

        // Randomly change weather every ~30 seconds
        if (this.weatherTimer > 30) {
            this.weatherTimer = 0;
            this.isRaining = Math.random() > 0.7; // 30% chance to rain

            if (this.isRaining) {
                this.scene.add(this.rainParticles!);
                // Make ground slippery
                this.player.friction = 0.98;
            } else {
                this.scene.remove(this.rainParticles!);
                // Normal friction
                this.player.friction = 0.95;
            }
        }

        if (this.isRaining && this.rainParticles && this.rainGeo) {
            // Follow player loosely
            this.rainParticles.position.x = this.player.mesh.position.x;
            this.rainParticles.position.z = this.player.mesh.position.z;

            // Animate rain drops
            const positions = this.rainGeo.attributes.position.array as Float32Array;
            for (let i = 0; i < this.rainCount; i++) {
                positions[i*3+1] -= 50 * deltaTime; // fall down
                if (positions[i*3+1] < 0) {
                    positions[i*3+1] = 200; // reset to top
                }
            }
            this.rainGeo.attributes.position.needsUpdate = true;
        }
    }
}
