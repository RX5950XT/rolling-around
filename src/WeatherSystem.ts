import * as THREE from 'three';
import { Player } from './Player';
import { SCENERY_LAYER } from './WorldManager';

const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

const SKY = {
    dayTop: new THREE.Color(0x4fa3ec), dayHorizon: new THREE.Color(0xcdeeff),
    duskTop: new THREE.Color(0x6c74c9), duskHorizon: new THREE.Color(0xffb08a),
    nightTop: new THREE.Color(0x0b1230), nightHorizon: new THREE.Color(0x2b3a6c),
    rainTop: new THREE.Color(0x7f8ba0), rainHorizon: new THREE.Color(0xbcc6d2),
    sun: new THREE.Color(0xfff1d6), lowSun: new THREE.Color(0xffa36b), moon: new THREE.Color(0xb8c8ff),
    grass: new THREE.Color(0x9ccf86), nightGrass: new THREE.Color(0x2f4a52),
};

const SKY_VERTEX = /* glsl */`
varying vec3 vDir;
void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */`
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uGlowDir;
uniform vec3 uGlowColor;
uniform float uDiscSharpness;
varying vec3 vDir;
void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.65, h), 0.75));
    col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.25, h));
    float d = max(dot(dir, uGlowDir), 0.0);
    col += uGlowColor * (smoothstep(1.0 - uDiscSharpness, 1.0 - uDiscSharpness * 0.6, d) * 1.2 + pow(d, 12.0) * 0.35);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export class WeatherSystem {
    private scene: THREE.Scene;
    private player: Player;
    private camera: THREE.PerspectiveCamera;

    public timeOfDay: number = 9;
    private timeSpeed: number = 0.1; // in-game hours per second: a full day takes 4 minutes

    private dirLight: THREE.DirectionalLight;
    private hemiLight: THREE.HemisphereLight;

    public isRaining: boolean = false;
    /** 0 = clear, 1 = full rain; eases in and out so the sky never pops. */
    private rainAmount = 0;
    /** 0 = full day, 1 = deep night. */
    public nightFactor = 0;

    private rain: THREE.LineSegments;
    private rainCount: number = 1500;
    private weatherTimer: number = 0;

    private sky: THREE.Mesh;
    private skyUniforms = {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGlowDir: { value: new THREE.Vector3(0, 1, 0) },
        uGlowColor: { value: new THREE.Color() },
        uDiscSharpness: { value: 0.0015 },
    };
    private stars: THREE.Points;
    private shadowRange = 0;
    private fogDensity = 0;

    // Image-based lighting: the live sky is re-baked into scene.environment whenever it visibly changes.
    private pmrem: THREE.PMREMGenerator;
    private envScene = new THREE.Scene();
    private envGround = new THREE.MeshBasicMaterial();
    private envTarget: THREE.WebGLRenderTarget | null = null;
    private envBakedAt = -1;
    private envRain = 0;

    private sunDir = new THREE.Vector3();
    private moonDir = new THREE.Vector3();
    private top = new THREE.Color();
    private horizon = new THREE.Color();

    constructor(
        scene: THREE.Scene, player: Player, dirLight: THREE.DirectionalLight, hemiLight: THREE.HemisphereLight,
        camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer,
    ) {
        this.scene = scene;
        this.player = player;
        this.dirLight = dirLight;
        this.hemiLight = hemiLight;
        this.camera = camera;

        this.sky = new THREE.Mesh(
            new THREE.SphereGeometry(1, 32, 16),
            new THREE.ShaderMaterial({
                uniforms: this.skyUniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT,
                side: THREE.BackSide, depthWrite: false, fog: false,
            })
        );
        this.sky.renderOrder = -1;
        this.sky.frustumCulled = false;
        this.sky.layers.set(SCENERY_LAYER);
        scene.add(this.sky);

        this.stars = this.createStars();
        this.rain = this.createRain();
        scene.add(this.stars);

        this.pmrem = new THREE.PMREMGenerator(renderer);
        const envGround = new THREE.Mesh(new THREE.CircleGeometry(9, 32).rotateX(-Math.PI / 2), this.envGround);
        envGround.position.y = -0.3;
        this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), this.sky.material), envGround);
    }

    private createStars(): THREE.Points {
        const positions = new Float32Array(900 * 3);
        for (let i = 0; i < 900; i++) {
            const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5).normalize();
            positions.set([v.x, v.y, v.z], i * 3);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const stars = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false,
        }));
        stars.frustumCulled = false;
        stars.layers.set(SCENERY_LAYER);
        return stars;
    }

    private createRain(): THREE.LineSegments {
        const positions = new Float32Array(this.rainCount * 6);
        for (let i = 0; i < this.rainCount; i++) {
            const x = Math.random() * 100 - 50;
            const y = Math.random() * 60;
            const z = Math.random() * 100 - 50;
            positions.set([x, y, z, x, y + 1.6, z], i * 6);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xdbe9ff, transparent: true, opacity: 0.5 }));
        rain.frustumCulled = false;
        rain.layers.set(SCENERY_LAYER);
        return rain;
    }

    public update(deltaTime: number, cameraDistance: number, worldRadius: number) {
        this.timeOfDay += this.timeSpeed * deltaTime;
        if (this.timeOfDay >= 24) this.timeOfDay -= 24;

        this.updateWeather(deltaTime);
        this.updateSky();
        this.updateSun();
        this.bakeEnvironment();

        // Fog reaches ~70% at the edge of the loaded world, so chunk borders melt into the horizon.
        // Eased (in ratio, since it spans orders of magnitude as the ball grows), because the loaded radius jumps at tier changes.
        if (this.scene.fog instanceof THREE.FogExp2) {
            const target = 1.1 / (cameraDistance * 1.6 + worldRadius) * (1 + this.rainAmount * 0.6);
            this.fogDensity = this.fogDensity === 0 ? target : this.fogDensity * Math.pow(target / this.fogDensity, Math.min(1, deltaTime * 1.5));
            this.scene.fog.color.copy(this.horizon);
            this.scene.fog.density = this.fogDensity;
        }
    }

    private updateSky() {
        const timeRad = ((this.timeOfDay - 6) / 24) * Math.PI * 2;
        this.sunDir.set(Math.cos(timeRad), Math.sin(timeRad) * 0.85, 0.5).normalize();
        const sunY = this.sunDir.y;
        const day = smoothstep(-0.12, 0.22, sunY);
        this.nightFactor = 1 - day;

        this.top.lerpColors(SKY.nightTop, SKY.dayTop, day);
        this.horizon.lerpColors(SKY.nightHorizon, SKY.dayHorizon, day);
        // Sunrise / sunset: warm the horizon while the sun is low.
        const dusk = (1 - smoothstep(0.05, 0.35, Math.abs(sunY))) * (sunY > -0.25 ? 1 : 0);
        this.horizon.lerp(SKY.duskHorizon, dusk * 0.85);
        this.top.lerp(SKY.duskTop, dusk * 0.35);
        this.top.lerp(SKY.rainTop, this.rainAmount * 0.75);
        this.horizon.lerp(SKY.rainHorizon, this.rainAmount * 0.7);

        const u = this.skyUniforms;
        u.uTop.value.copy(this.top);
        u.uHorizon.value.copy(this.horizon);
        const useSun = sunY > -0.02;
        u.uGlowDir.value.copy(this.sunDir).multiplyScalar(useSun ? 1 : -1);
        u.uGlowColor.value.copy(useSun ? SKY.sun : SKY.moon).multiplyScalar(1 - this.rainAmount * 0.85);
        u.uDiscSharpness.value = useSun ? 0.0018 : 0.0008;
        (this.scene.background as THREE.Color).copy(this.horizon);

        const cam = this.camera.position;
        const r = this.camera.far * 0.9;
        this.sky.position.copy(cam);
        this.sky.scale.setScalar(r);
        this.stars.position.copy(cam);
        this.stars.scale.setScalar(r * 0.95);
        (this.stars.material as THREE.PointsMaterial).opacity = smoothstep(0.4, 0.9, this.nightFactor) * (1 - this.rainAmount);
    }

    /** Sun (or moon) light follows the player so shadows exist everywhere, scaled to the ball. */
    private updateSun() {
        const sunY = this.sunDir.y;
        const useSun = sunY > -0.02;
        const lightDir = useSun ? this.sunDir : this.moonDir.copy(this.sunDir).negate();
        const strength = smoothstep(-0.02, 0.25, useSun ? sunY : -sunY);
        this.dirLight.intensity = (useSun ? 2.8 : 1.0) * strength * (1 - this.rainAmount * 0.55);
        if (useSun) this.dirLight.color.lerpColors(SKY.lowSun, SKY.sun, smoothstep(0.0, 0.45, sunY));
        else this.dirLight.color.copy(SKY.moon);

        const day = 1 - this.nightFactor;
        // The baked sky lights the day; the hemisphere mostly keeps moonlit nights readable.
        this.hemiLight.intensity = (0.75 - day * 0.25) * (1 - this.rainAmount * 0.2);
        this.hemiLight.color.copy(this.top).lerp(SKY.dayHorizon, 0.5);
        this.hemiLight.groundColor.lerpColors(SKY.nightGrass, SKY.grass, day);

        const range = Math.max(40, this.player.size * 7);
        const p = this.player.mesh.position;
        this.dirLight.target.position.copy(p);
        this.dirLight.position.copy(p).addScaledVector(lightDir, range * 3);
        if (Math.abs(range - this.shadowRange) > this.shadowRange * 0.05) {
            this.shadowRange = range;
            const cam = this.dirLight.shadow.camera;
            cam.left = -range;
            cam.right = range;
            cam.top = range;
            cam.bottom = -range;
            cam.near = range * 0.5;
            cam.far = range * 6;
            cam.updateProjectionMatrix();
            this.dirLight.shadow.normalBias = range * 0.0015;
        }
    }

    /** Re-render the sky into the environment map only after ~3 s of in-game time or a rain change (a bake costs a few ms). */
    private bakeEnvironment() {
        const dt = Math.abs(this.timeOfDay - this.envBakedAt);
        if (Math.min(dt, 24 - dt) < 0.3 && Math.abs(this.rainAmount - this.envRain) < 0.1) return;
        this.envBakedAt = this.timeOfDay;
        this.envRain = this.rainAmount;
        this.envGround.color.copy(this.hemiLight.groundColor).multiplyScalar(0.6);
        const target = this.pmrem.fromScene(this.envScene, 0.02);
        this.envTarget?.dispose();
        this.envTarget = target;
        this.scene.environment = target.texture;
        this.scene.environmentIntensity = 0.8; // the sky is blue: a full-strength fill turns the grass teal
    }

    private updateWeather(deltaTime: number) {
        this.weatherTimer += deltaTime;
        if (this.weatherTimer > 35) {
            this.weatherTimer = 0;
            this.isRaining = Math.random() < 0.3;
            if (this.isRaining) this.scene.add(this.rain);
        }

        const target = this.isRaining ? 1 : 0;
        this.rainAmount += (target - this.rainAmount) * Math.min(1, deltaTime * 0.6);
        // Wet grass: the ball keeps more of its speed and slides through turns.
        this.player.weatherFrictionModifier = 1 + this.rainAmount * 1.2;
        (this.rain.material as THREE.LineBasicMaterial).opacity = 0.5 * this.rainAmount;

        if (this.rainAmount < 0.01) {
            if (this.rain.parent) this.scene.remove(this.rain);
            return;
        }
        this.updateRain(deltaTime);
    }

    private updateRain(deltaTime: number) {
        // Rain lives around the camera, scaled with the ball so it stays visible at any size.
        const k = Math.max(1, this.player.size * 0.4);
        this.rain.position.set(this.camera.position.x, this.camera.position.y - 30 * k, this.camera.position.z);
        this.rain.scale.setScalar(k);
        const positions = this.rain.geometry.attributes.position.array as Float32Array;
        const fall = 70 * deltaTime;
        for (let i = 0; i < this.rainCount; i++) {
            const o = i * 6;
            positions[o + 1] -= fall;
            positions[o + 4] -= fall;
            if (positions[o + 1] < 0) {
                positions[o + 1] += 60;
                positions[o + 4] += 60;
            }
        }
        this.rain.geometry.attributes.position.needsUpdate = true;
    }
}
