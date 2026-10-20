import { Engine } from './Engine';
import { Player } from './Player';

const JOYSTICK_RADIUS = 56;
const DEAD_ZONE = 8;

/** Left half: floating joystick. Right half: drag to look. Buttons: jump (tap) and sprint (hold). */
export class TouchControls {
    private moveId: number | null = null;
    private lookId: number | null = null;
    private origin = { x: 0, y: 0 };
    private last = { x: 0, y: 0 };

    constructor(private player: Player, private engine: Engine) {
        const canvas = engine.renderer.domElement;
        const joystick = document.getElementById('joystick')!;
        const knob = joystick.firstElementChild as HTMLElement;

        canvas.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'touch') return;
            if (e.clientX < window.innerWidth * 0.5 && this.moveId === null) {
                this.moveId = e.pointerId;
                this.origin = { x: e.clientX, y: e.clientY };
                joystick.style.left = `${e.clientX}px`;
                joystick.style.top = `${e.clientY}px`;
                joystick.classList.add('active');
            } else if (this.lookId === null) {
                this.lookId = e.pointerId;
                this.last = { x: e.clientX, y: e.clientY };
            }
        });

        canvas.addEventListener('pointermove', (e) => {
            if (e.pointerId === this.moveId) {
                const dx = e.clientX - this.origin.x;
                const dy = e.clientY - this.origin.y;
                const len = Math.hypot(dx, dy);
                const clamp = len > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / len : 1;
                knob.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`;
                const strength = len < DEAD_ZONE ? 0 : Math.min(1, len / JOYSTICK_RADIUS) / len;
                this.player.touchMove.set(dx * strength, dy * strength);
            } else if (e.pointerId === this.lookId) {
                this.engine.cameraAngle -= (e.clientX - this.last.x) * 0.006;
                this.engine.rotatePitch((e.clientY - this.last.y) * 0.004);
                this.last = { x: e.clientX, y: e.clientY };
            }
        });

        const release = (e: PointerEvent) => {
            if (e.pointerId === this.moveId) {
                this.moveId = null;
                this.player.touchMove.set(0, 0);
                joystick.classList.remove('active');
                knob.style.transform = '';
            }
            if (e.pointerId === this.lookId) this.lookId = null;
        };
        canvas.addEventListener('pointerup', release);
        canvas.addEventListener('pointercancel', release);

        const press = (id: string, action: () => void) => {
            document.getElementById(id)!.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                action();
            });
        };
        press('touch-jump', () => this.player.attemptJump());
        const sprint = document.getElementById('touch-dash')!;
        press('touch-dash', () => { this.player.touchSprint = true; });
        for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
            sprint.addEventListener(type, () => { this.player.touchSprint = false; });
        }
    }
}
