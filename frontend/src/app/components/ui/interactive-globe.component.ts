import {
    Component, Input, OnInit, OnDestroy, AfterViewInit,
    ElementRef, ViewChild, NgZone
} from '@angular/core';

interface MarkerDef { lat: number; lng: number; label?: string; }
interface ConnectionDef { from: [number, number]; to: [number, number]; }

const DEFAULT_MARKERS: MarkerDef[] = [
    { lat: 37.78, lng: -122.42, label: 'San Francisco' },
    { lat: 51.51, lng: -0.13, label: 'London' },
    { lat: 35.68, lng: 139.69, label: 'Tokyo' },
    { lat: -33.87, lng: 151.21, label: 'Sydney' },
    { lat: 1.35, lng: 103.82, label: 'Singapore' },
    { lat: 55.76, lng: 37.62, label: 'Moscow' },
    { lat: -23.55, lng: -46.63, label: 'São Paulo' },
    { lat: 19.43, lng: -99.13, label: 'Mexico City' },
    { lat: 28.61, lng: 77.21, label: 'Delhi' },
    { lat: 36.19, lng: 44.01, label: 'Erbil' },
];

const DEFAULT_CONNECTIONS: ConnectionDef[] = [
    { from: [37.78, -122.42], to: [51.51, -0.13] },
    { from: [51.51, -0.13], to: [35.68, 139.69] },
    { from: [35.68, 139.69], to: [-33.87, 151.21] },
    { from: [37.78, -122.42], to: [1.35, 103.82] },
    { from: [51.51, -0.13], to: [28.61, 77.21] },
    { from: [37.78, -122.42], to: [-23.55, -46.63] },
    { from: [1.35, 103.82], to: [-33.87, 151.21] },
    { from: [28.61, 77.21], to: [36.19, 44.01] },
    { from: [51.51, -0.13], to: [36.19, 44.01] },
];

function latLngToXYZ(lat: number, lng: number, radius: number): [number, number, number] {
    const phi = ((90 - lat) * Math.PI) / 180;
    const theta = ((lng + 180) * Math.PI) / 180;
    return [
        -(radius * Math.sin(phi) * Math.cos(theta)),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta),
    ];
}

function rotateY(x: number, y: number, z: number, angle: number): [number, number, number] {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return [x * cos + z * sin, y, -x * sin + z * cos];
}

function rotateX(x: number, y: number, z: number, angle: number): [number, number, number] {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return [x, y * cos - z * sin, y * sin + z * cos];
}

function project(x: number, y: number, z: number, cx: number, cy: number, fov: number): [number, number, number] {
    const scale = fov / (fov + z);
    return [x * scale + cx, y * scale + cy, z];
}

@Component({
    selector: 'app-interactive-globe',
    standalone: true,
    template: `
        <canvas #globeCanvas
            [style.width.px]="size"
            [style.height.px]="size"
            style="cursor: grab; display: block; max-width: 100%;"
            (pointerdown)="onPointerDown($event)"
            (pointermove)="onPointerMove($event)"
            (pointerup)="onPointerUp($event)"
            (pointerleave)="onPointerUp($event)">
        </canvas>
    `,
})
export class InteractiveGlobeComponent implements AfterViewInit, OnDestroy {
    @ViewChild('globeCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

    @Input() size = 460;
    @Input() dotColor = 'rgba(100, 180, 255, ALPHA)';
    @Input() arcColor = 'rgba(100, 180, 255, 0.5)';
    @Input() markerColor = 'rgba(100, 220, 255, 1)';
    @Input() autoRotateSpeed = 0.002;
    @Input() connections: ConnectionDef[] = DEFAULT_CONNECTIONS;
    @Input() markers: MarkerDef[] = DEFAULT_MARKERS;

    private rotY = 0.4;
    private rotX = 0.3;
    private drag = { active: false, startX: 0, startY: 0, startRotY: 0, startRotX: 0 };
    private animId = 0;
    private time = 0;
    private dots: [number, number, number][] = [];

    constructor(private ngZone: NgZone) { }

    ngAfterViewInit(): void {
        this.buildDots();
        this.ngZone.runOutsideAngular(() => this.loop());
    }

    ngOnDestroy(): void {
        cancelAnimationFrame(this.animId);
    }

    // ── Build fibonacci sphere dots ──────────────────────────────────────────
    private buildDots(): void {
        const numDots = 1200;
        const goldenRatio = (1 + Math.sqrt(5)) / 2;
        for (let i = 0; i < numDots; i++) {
            const theta = (2 * Math.PI * i) / goldenRatio;
            const phi = Math.acos(1 - (2 * (i + 0.5)) / numDots);
            this.dots.push([
                Math.cos(theta) * Math.sin(phi),
                Math.cos(phi),
                Math.sin(theta) * Math.sin(phi),
            ]);
        }
    }

    // ── Main render loop ─────────────────────────────────────────────────────
    private loop(): void {
        this.draw();
        this.animId = requestAnimationFrame(() => this.loop());
    }

    private draw(): void {
        const canvas = this.canvasRef?.nativeElement;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const w = this.size;
        const h = this.size;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.38;
        const fov = 600;

        if (!this.drag.active) this.rotY += this.autoRotateSpeed;
        this.time += 0.015;

        ctx.clearRect(0, 0, w, h);

        // Outer glow
        const glow = ctx.createRadialGradient(cx, cy, radius * 0.8, cx, cy, radius * 1.5);
        glow.addColorStop(0, 'rgba(60,140,255,0.03)');
        glow.addColorStop(1, 'rgba(60,140,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        // Globe outline
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(100,180,255,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        const ry = this.rotY;
        const rx = this.rotX;

        // ── Dots ──────────────────────────────────────────────────────────────
        for (const dot of this.dots) {
            let [x, y, z] = dot;
            x *= radius; y *= radius; z *= radius;
            [x, y, z] = rotateX(x, y, z, rx);
            [x, y, z] = rotateY(x, y, z, ry);
            if (z > 0) continue;
            const [sx, sy] = project(x, y, z, cx, cy, fov);
            const depthAlpha = Math.max(0.1, 1 - (z + radius) / (2 * radius));
            const dotSize = 1 + depthAlpha * 0.8;
            ctx.beginPath();
            ctx.arc(sx, sy, dotSize, 0, Math.PI * 2);
            ctx.fillStyle = this.dotColor.replace('ALPHA', depthAlpha.toFixed(2));
            ctx.fill();
        }

        // ── Arcs + traveling dots ─────────────────────────────────────────────
        for (const conn of this.connections) {
            const [lat1, lng1] = conn.from;
            const [lat2, lng2] = conn.to;

            let [x1, y1, z1] = latLngToXYZ(lat1, lng1, radius);
            let [x2, y2, z2] = latLngToXYZ(lat2, lng2, radius);
            [x1, y1, z1] = rotateX(x1, y1, z1, rx);
            [x1, y1, z1] = rotateY(x1, y1, z1, ry);
            [x2, y2, z2] = rotateX(x2, y2, z2, rx);
            [x2, y2, z2] = rotateY(x2, y2, z2, ry);

            if (z1 > radius * 0.3 && z2 > radius * 0.3) continue;

            const [sx1, sy1] = project(x1, y1, z1, cx, cy, fov);
            const [sx2, sy2] = project(x2, y2, z2, cx, cy, fov);

            const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2, midZ = (z1 + z2) / 2;
            const midLen = Math.sqrt(midX * midX + midY * midY + midZ * midZ);
            const arcH = radius * 1.25;
            const [scx, scy] = project(
                (midX / midLen) * arcH, (midY / midLen) * arcH, (midZ / midLen) * arcH,
                cx, cy, fov
            );

            ctx.beginPath();
            ctx.moveTo(sx1, sy1);
            ctx.quadraticCurveTo(scx, scy, sx2, sy2);
            ctx.strokeStyle = this.arcColor;
            ctx.lineWidth = 1.2;
            ctx.stroke();

            // Traveling dot
            const t = (Math.sin(this.time * 1.2 + lat1 * 0.1) + 1) / 2;
            const tx = (1 - t) * (1 - t) * sx1 + 2 * (1 - t) * t * scx + t * t * sx2;
            const ty = (1 - t) * (1 - t) * sy1 + 2 * (1 - t) * t * scy + t * t * sy2;
            ctx.beginPath();
            ctx.arc(tx, ty, 2, 0, Math.PI * 2);
            ctx.fillStyle = this.markerColor;
            ctx.fill();
        }

        // ── City markers ──────────────────────────────────────────────────────
        for (const marker of this.markers) {
            let [x, y, z] = latLngToXYZ(marker.lat, marker.lng, radius);
            [x, y, z] = rotateX(x, y, z, rx);
            [x, y, z] = rotateY(x, y, z, ry);
            if (z > radius * 0.1) continue;

            const [sx, sy] = project(x, y, z, cx, cy, fov);
            const pulse = Math.sin(this.time * 2 + marker.lat) * 0.5 + 0.5;

            ctx.beginPath();
            ctx.arc(sx, sy, 4 + pulse * 4, 0, Math.PI * 2);
            ctx.strokeStyle = this.markerColor.replace('1)', `${0.2 + pulse * 0.15})`);
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = this.markerColor;
            ctx.fill();

            if (marker.label) {
                ctx.font = '10px system-ui, sans-serif';
                ctx.fillStyle = this.markerColor.replace('1)', '0.6)');
                ctx.fillText(marker.label, sx + 8, sy + 3);
            }
        }
    }

    // ── Pointer drag handlers ─────────────────────────────────────────────────
    onPointerDown(e: PointerEvent): void {
        this.drag = { active: true, startX: e.clientX, startY: e.clientY, startRotY: this.rotY, startRotX: this.rotX };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }

    onPointerMove(e: PointerEvent): void {
        if (!this.drag.active) return;
        const dx = e.clientX - this.drag.startX;
        const dy = e.clientY - this.drag.startY;
        this.rotY = this.drag.startRotY + dx * 0.005;
        this.rotX = Math.max(-1, Math.min(1, this.drag.startRotX + dy * 0.005));
    }

    onPointerUp(_e: PointerEvent): void {
        this.drag.active = false;
    }
}
