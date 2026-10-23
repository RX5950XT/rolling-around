import { Engine } from './Engine';
import { Player } from './Player';

const JOYSTICK_RADIUS = 48;
const DEAD_ZONE = 8;

/** Left half: floating joystick. Right half: drag to look. Each finger keeps its own action. */
export class TouchControls {
    private moveId: number | null = null;
    private lookId: number | null = null;
    private sprintId: number | null = null;
    private origin = { x: 0, y: 0 };
    private last = { x: 0, y: 0 };
    private canvas: HTMLCanvasElement;
    private joystick = document.getElementById('joystick')!;
    private knob = this.joystick.firstElementChild as HTMLElement;
    private sprint = document.getElementById('touch-dash')!;

    constructor(private player: Player, private engine: Engine) {
        this.canvas = engine.renderer.domElement;
        this.canvas.addEventListener('pointerdown', this.start);
        this.canvas.addEventListener('pointermove', this.move);
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
            this.canvas.addEventListener(type, this.release);
            this.sprint.addEventListener(type, this.release);
        }
        document.getElementById('touch-jump')!.addEventListener('pointerdown', (e) => {
            if (!this.player.enabled) return;
            e.preventDefault();
            this.player.attemptJump();
        });
        this.sprint.addEventListener('pointerdown', (e) => {
            if (!this.player.enabled || this.sprintId !== null) return;
            e.preventDefault();
            this.sprintId = e.pointerId;
            this.sprint.setPointerCapture(e.pointerId);
            this.player.touchSprint = true;
            this.sprint.classList.add('held');
        });
        window.addEventListener('blur', () => this.reset());
        window.addEventListener('resize', () => this.reset());
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.reset();
        });
    }

    private start = (e: PointerEvent) => {
        if (e.pointerType !== 'touch' || !this.player.enabled) return;
        if (e.clientX < window.innerWidth * 0.5) {
            if (this.moveId !== null) return;
            this.moveId = e.pointerId;
            this.origin = { x: Math.max(60, Math.min(innerWidth - 60, e.clientX)),
                y: Math.max(60, Math.min(innerHeight - 60, e.clientY)) };
            this.joystick.style.left = `${this.origin.x}px`;
            this.joystick.style.top = `${this.origin.y}px`;
            this.joystick.classList.add('active');
        } else {
            if (this.lookId !== null) return;
            this.lookId = e.pointerId;
            this.last = { x: e.clientX, y: e.clientY };
        }
        e.preventDefault();
        this.canvas.setPointerCapture(e.pointerId);
    };

    private move = (e: PointerEvent) => {
        if (!this.player.enabled) return;
        if (e.pointerId === this.moveId) {
            const dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
            const len = Math.hypot(dx, dy);
            const clamp = Math.min(1, JOYSTICK_RADIUS / (len || 1));
            this.knob.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`;
            const strength = len <= DEAD_ZONE ? 0 : Math.min(1, (len - DEAD_ZONE) / (JOYSTICK_RADIUS - DEAD_ZONE)) / len;
            this.player.touchMove.set(dx * strength, dy * strength);
        } else if (e.pointerId === this.lookId) {
            this.engine.cameraAngle -= (e.clientX - this.last.x) * 0.006;
            this.engine.rotatePitch((e.clientY - this.last.y) * 0.004);
            this.last = { x: e.clientX, y: e.clientY };
        }
    };

    private release = (e: Pick<PointerEvent, 'pointerId'>) => {
        if (e.pointerId === this.moveId) {
            this.moveId = null;
            this.player.touchMove.set(0, 0);
            this.joystick.classList.remove('active');
            this.joystick.style.removeProperty('left');
            this.joystick.style.removeProperty('top');
            this.knob.style.transform = '';
        }
        if (e.pointerId === this.lookId) this.lookId = null;
        if (e.pointerId === this.sprintId) {
            this.sprintId = null;
            this.player.touchSprint = false;
            this.sprint.classList.remove('held');
        }
    };

    public reset() {
        for (const [target, id] of [[this.canvas, this.moveId], [this.canvas, this.lookId],
            [this.sprint, this.sprintId]] as const) {
            if (id === null) continue;
            this.release({ pointerId: id });
            if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
        }
    }
}
