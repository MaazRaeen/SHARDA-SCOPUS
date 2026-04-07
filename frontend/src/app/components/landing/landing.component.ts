import {
    Component, OnInit, OnDestroy, AfterViewInit,
    NgZone, ElementRef, HostListener
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Observable, tap } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { InteractiveGlobeComponent } from '../ui/interactive-globe.component';

interface Particle {
    x: number; y: number;
    vx: number; vy: number;
    size: number;
    opacity: number;
    color: string;
}

@Component({
    selector: 'app-landing',
    standalone: true,
    imports: [CommonModule, RouterLink, InteractiveGlobeComponent],
    templateUrl: './landing.component.html',
    styleUrls: ['./landing.component.css']
})
export class LandingComponent implements OnInit, AfterViewInit, OnDestroy {
    user$: Observable<any>;

    private rafId: number | null = null;
    private particles: Particle[] = [];
    private canvas!: HTMLCanvasElement;
    private ctx!: CanvasRenderingContext2D;
    private mouseX = -1000;
    private mouseY = -1000;
    private cursorX = 0;
    private cursorY = 0;
    private ringX = 0;
    private ringY = 0;
    private observer: IntersectionObserver | null = null;
    private statsCounted = false;
    private typewriterTimeout: ReturnType<typeof setTimeout> | null = null;
    private resizeHandler = this.onResize.bind(this);

    constructor(
        private authService: AuthService,
        private ngZone: NgZone,
        private el: ElementRef
    ) {
        this.user$ = this.authService.user$.pipe(
            tap(u => console.log('[Landing] Auth:', u))
        );
    }

    ngOnInit() { }

    ngAfterViewInit() {
        this.ngZone.runOutsideAngular(() => {
            this.initCanvas();
            this.initCursor();
            this.initScrollEffects();
            this.initTilt();
            this.initParallax();
            this.startTypewriter();
            // New next-level effects
            this.initSpotlight();
            this.initMagneticButtons();
            this.initRipple();
        });
    }

    ngOnDestroy() {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        if (this.observer) this.observer.disconnect();
        if (this.typewriterTimeout) clearTimeout(this.typewriterTimeout);
        window.removeEventListener('resize', this.resizeHandler);
    }

    @HostListener('window:scroll')
    onScroll() {
        this.ngZone.runOutsideAngular(() => {
            const nav = document.getElementById('navbar');
            if (nav) nav.classList.toggle('scrolled', window.scrollY > 60);
        });
    }

    // ─── CANVAS PARTICLE NETWORK ─────────────────────────────────────────────
    private initCanvas() {
        this.canvas = document.getElementById('particle-canvas') as HTMLCanvasElement;
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d')!;
        this.resizeCanvas();
        window.addEventListener('resize', this.resizeHandler);

        // Create particles
        const count = Math.min(120, Math.floor(window.innerWidth / 12));
        const colors = ['rgba(79,142,247,', 'rgba(124,58,237,', 'rgba(6,182,212,'];
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                size: Math.random() * 1.8 + 0.5,
                opacity: Math.random() * 0.5 + 0.15,
                color: colors[Math.floor(Math.random() * colors.length)]
            });
        }
        this.animateParticles();
    }

    private resizeCanvas() {
        if (!this.canvas) return;
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    private onResize() { this.resizeCanvas(); }

    private animateParticles() {
        const { ctx, canvas, particles, mouseX, mouseY } = this;
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const p of particles) {
            // Mouse repulsion (subtle)
            const dx = p.x - mouseX;
            const dy = p.y - mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 150) {
                const force = (150 - dist) / 150 * 0.6;
                p.vx += (dx / dist) * force * 0.04;
                p.vy += (dy / dist) * force * 0.04;
            }

            // Speed cap
            const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (speed > 1.2) { p.vx = p.vx / speed * 1.2; p.vy = p.vy / speed * 1.2; }

            p.x += p.vx;
            p.y += p.vy;

            // Wrap around edges
            if (p.x < 0) p.x = canvas.width;
            if (p.x > canvas.width) p.x = 0;
            if (p.y < 0) p.y = canvas.height;
            if (p.y > canvas.height) p.y = 0;

            // Draw particle
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color + p.opacity + ')';
            ctx.fill();
        }

        // Draw connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < 120) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(79,142,247,${(1 - d / 120) * 0.12})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }

        this.rafId = requestAnimationFrame(() => this.animateParticles());
    }

    // ─── CUSTOM CURSOR (dual-ring) ────────────────────────────────────────────
    private initCursor() {
        const dot = document.getElementById('custom-cursor');
        const ring = document.getElementById('cursor-ring');
        if (!dot || !ring) return;

        document.addEventListener('mousemove', (e) => {
            this.mouseX = e.clientX;
            this.mouseY = e.clientY;
        });

        const animateCursor = () => {
            this.cursorX += (this.mouseX - this.cursorX) * 0.28;
            this.cursorY += (this.mouseY - this.cursorY) * 0.28;
            this.ringX += (this.mouseX - this.ringX) * 0.10;
            this.ringY += (this.mouseY - this.ringY) * 0.10;

            dot.style.left = `${this.cursorX}px`;
            dot.style.top = `${this.cursorY}px`;
            ring.style.left = `${this.ringX}px`;
            ring.style.top = `${this.ringY}px`;

            requestAnimationFrame(animateCursor);
        };
        animateCursor();

        document.querySelectorAll('.hover-target, a, button').forEach(el => {
            el.addEventListener('mouseenter', () => {
                dot.classList.add('hovering');
                ring.classList.add('hovering');
            });
            el.addEventListener('mouseleave', () => {
                dot.classList.remove('hovering');
                ring.classList.remove('hovering');
            });
        });
    }

    // ─── INTERSECTION OBSERVER (scroll reveals + counters) ───────────────────
    private initScrollEffects() {
        const viewportH = window.innerHeight;

        // Mark elements that are BELOW the fold as pending reveal (invisible)
        document.querySelectorAll('.feat-card, .stat-card, .cta-inner').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top > viewportH) {
                el.classList.add('reveal-pending');
            }
        });

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                el.classList.add('in-view');
                el.classList.remove('reveal-pending');

                // Trigger stat counters when stats section is reached
                if (el.classList.contains('stats-wrap') && !this.statsCounted) {
                    this.statsCounted = true;
                    this.runCounters();
                }

                // Cascade reveal pending children
                el.querySelectorAll('.feat-card.reveal-pending, .stat-card.reveal-pending, .cta-inner.reveal-pending')
                    .forEach((c, i) => {
                        setTimeout(() => {
                            c.classList.add('in-view');
                            c.classList.remove('reveal-pending');
                        }, i * 120);
                    });
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

        document.querySelectorAll('.observe-section, .stats-wrap, .stat-card, .cta-inner').forEach(el => {
            this.observer?.observe(el);
        });
    }

    private runCounters() {
        document.querySelectorAll('.stat-num[data-target]').forEach(el => {
            const target = parseFloat(el.getAttribute('data-target') || '0');
            const suffix = el.getAttribute('data-suffix') || '';
            const isFloat = String(target).includes('.');
            const duration = 2200;
            const start = performance.now();

            const tick = (now: number) => {
                const p = Math.min((now - start) / duration, 1);
                const ease = 1 - Math.pow(1 - p, 4);
                const val = target * ease;
                (el as HTMLElement).innerText = (isFloat ? val.toFixed(1) : Math.floor(val).toLocaleString()) + suffix;
                if (p < 1) requestAnimationFrame(tick);
                else (el as HTMLElement).innerText = (isFloat ? target.toFixed(1) : target.toLocaleString()) + suffix;
            };
            requestAnimationFrame(tick);
        });
    }

    // ─── TYPEWRITER ───────────────────────────────────────────────────────────
    private startTypewriter() {
        const el = document.getElementById('typewriter-el');
        if (!el) return;

        const phrases = [
            'Academic Intelligence',
            'Citation Analytics',
            'Research Impact',
            'Publication Insights',
            'H-Index Tracking'
        ];

        let phraseIndex = 0;
        let charIndex = 0;
        let deleting = false;

        const type = () => {
            const phrase = phrases[phraseIndex];
            if (!deleting) {
                el.textContent = phrase.substring(0, charIndex + 1);
                charIndex++;
                if (charIndex === phrase.length) {
                    deleting = true;
                    this.typewriterTimeout = setTimeout(type, 2200);
                    return;
                }
                this.typewriterTimeout = setTimeout(type, 65);
            } else {
                el.textContent = phrase.substring(0, charIndex - 1);
                charIndex--;
                if (charIndex === 0) {
                    deleting = false;
                    phraseIndex = (phraseIndex + 1) % phrases.length;
                    this.typewriterTimeout = setTimeout(type, 300);
                    return;
                }
                this.typewriterTimeout = setTimeout(type, 35);
            }
        };
        setTimeout(type, 800);
    }

    // ─── 3D TILT ON FEATURE CARDS ────────────────────────────────────────────
    private initTilt() {
        document.querySelectorAll('.tilt-me').forEach((card: Element) => {
            const el = card as HTMLElement;
            el.addEventListener('mousemove', (e: Event) => {
                const me = e as MouseEvent;
                const rect = el.getBoundingClientRect();
                const x = me.clientX - rect.left;
                const y = me.clientY - rect.top;
                const cx = rect.width / 2;
                const cy = rect.height / 2;
                const rx = ((y - cy) / cy) * -7;
                const ry = ((x - cx) / cx) * 7;

                // Track mouse for the inner glow
                const inner = el.querySelector('.feat-card-inner') as HTMLElement;
                if (inner) {
                    inner.style.setProperty('--mx', `${x}px`);
                    inner.style.setProperty('--my', `${y}px`);
                }

                el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) scale3d(1.02,1.02,1.02)`;
            });
            el.addEventListener('mouseleave', () => {
                el.style.transform = '';
            });
        });
    }

    // ─── HERO PARALLAX GRID ───────────────────────────────────────────────────
    private initParallax() {
        const grid = document.getElementById('parallax-grid');
        if (!grid) return;
        document.addEventListener('mousemove', (e: MouseEvent) => {
            const x = (e.clientX / window.innerWidth - 0.5) * 25;
            const y = (e.clientY / window.innerHeight - 0.5) * 25;
            grid.style.transform = `translate(${x}px, ${y}px)`;
        });
    }

    // ─── HERO SPOTLIGHT (mouse-tracked radial glow) ────────────────────────
    private initSpotlight() {
        const spotlight = document.getElementById('hero-spotlight');
        if (!spotlight) return;
        const hero = document.querySelector('.hero') as HTMLElement;
        if (!hero) return;

        hero.addEventListener('mousemove', (e: Event) => {
            const me = e as MouseEvent;
            const rect = hero.getBoundingClientRect();
            const x = ((me.clientX - rect.left) / rect.width * 100).toFixed(1);
            const y = ((me.clientY - rect.top) / rect.height * 100).toFixed(1);
            spotlight.style.setProperty('--sx', `${x}%`);
            spotlight.style.setProperty('--sy', `${y}%`);
        });
    }

    // ─── MAGNETIC BUTTONS (physically follow cursor) ───────────────────────
    private initMagneticButtons() {
        document.querySelectorAll('.btn-primary, .btn-outline').forEach(el => {
            const btn = el as HTMLElement;
            let bx = 0, by = 0;
            let targetBx = 0, targetBy = 0;

            btn.addEventListener('mousemove', (e: Event) => {
                const me = e as MouseEvent;
                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                targetBx = (me.clientX - cx) * 0.35;
                targetBy = (me.clientY - cy) * 0.35;
            });

            btn.addEventListener('mouseleave', () => {
                targetBx = 0; targetBy = 0;
            });

            const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
            const animate = () => {
                bx = lerp(bx, targetBx, 0.12);
                by = lerp(by, targetBy, 0.12);
                btn.style.setProperty('--bx', `${bx.toFixed(2)}px`);
                btn.style.setProperty('--by', `${by.toFixed(2)}px`);
                requestAnimationFrame(animate);
            };
            animate();
        });
    }

    // ─── RIPPLE ON BUTTON CLICK ───────────────────────────────────────────
    private initRipple() {
        document.querySelectorAll('.btn-primary').forEach(el => {
            el.addEventListener('click', (e: Event) => {
                const me = e as MouseEvent;
                const btn = el as HTMLElement;
                const rect = btn.getBoundingClientRect();
                const size = Math.max(rect.width, rect.height);
                const x = me.clientX - rect.left - size / 2;
                const y = me.clientY - rect.top - size / 2;

                const ripple = document.createElement('span');
                ripple.className = 'btn-ripple';
                ripple.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
                btn.appendChild(ripple);
                // Remove after animation
                setTimeout(() => ripple.remove(), 700);
            });
        });
    }
}
