import { Component, OnInit, AfterViewInit, OnDestroy, ElementRef, NgZone, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { PaperService } from '../../services/paper.service';

interface Particle {
    x: number; y: number; vx: number; vy: number;
    size: number; opacity: number; color: string;
}

@Component({
    selector: 'app-profile',
    standalone: true,
    imports: [CommonModule, RouterLink, FormsModule],
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit, AfterViewInit, OnDestroy {
    @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

    user: any = null;
    activeTab: string = 'overview';
    profileImage: string | null = null;

    passwordData = { currentPassword: '', password: '', confirmPassword: '' };
    passwordStatus: { type: 'success' | 'error' | null; message: string } = { type: null, message: '' };
    isUpdatingPassword = false;

    isPersonalDash = false;
    authorStats: any = null;
    personalPapers: any[] = [];
    allPersonalPapers: any[] = [];
    isLoadingPapers = false;

    scholarData: any = null;
    isLoadingScholar = false;
    scholarError = '';
    scholarLinkUrl = '';
    isLinkingScholar = false;
    scholarRefreshMsg = '';

    private particles: Particle[] = [];
    private canvas!: HTMLCanvasElement;
    private ctx!: CanvasRenderingContext2D;
    private rafId: number | null = null;
    private resizeHandler = () => this.resizeCanvas();

    constructor(
        private authService: AuthService,
        private paperService: PaperService,
        private router: Router,
        private ngZone: NgZone
    ) { }

    ngOnInit(): void {
        this.authService.user$.subscribe(userData => {
            this.user = userData;
            if (!this.user) {
                this.router.navigate(['/auth']);
            } else {
                this.isPersonalDash = this.user.role === 'Professor' && this.user.designation === 'Other';
                if (this.isPersonalDash) {
                    this.loadPersonalResearch();
                    this.loadScholarData();
                }
                const saved = localStorage.getItem(`pfp_${this.user.email}`);
                if (saved) this.profileImage = saved;
            }
        });
    }

    ngAfterViewInit(): void {
        this.ngZone.runOutsideAngular(() => {
            this.initParticleCanvas();
            this.initCardGlow();
            this.initSidebarMagnetic();
            this.initAvatarTilt();
            setTimeout(() => this.triggerEntranceAnimations(), 200);
        });
        window.addEventListener('resize', this.resizeHandler);
    }

    ngOnDestroy(): void {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        window.removeEventListener('resize', this.resizeHandler);
    }

    setActiveTab(tab: string) {
        this.activeTab = tab;
        this.passwordStatus = { type: null, message: '' };
        // Increment generation so any in-flight animation from a previous click is cancelled
        this._animGen++;
        const gen = this._animGen;
        setTimeout(() => this.triggerEntranceAnimations(gen), 80);
    }

    private _animGen = 0;

    // ─── CANVAS PARTICLE NETWORK ───────────────────────────────────────────
    private initParticleCanvas() {
        this.canvas = document.getElementById('profile-canvas') as HTMLCanvasElement;
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d')!;
        this.resizeCanvas();

        const count = Math.min(80, Math.floor(window.innerWidth / 18));
        const colors = ['rgba(79,142,247,', 'rgba(124,58,237,', 'rgba(6,182,212,'];
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 1.5 + 0.4,
                opacity: Math.random() * 0.4 + 0.1,
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

    private animateParticles() {
        const { ctx, canvas, particles } = this;
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const p of particles) {
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0) p.x = canvas.width;
            if (p.x > canvas.width) p.x = 0;
            if (p.y < 0) p.y = canvas.height;
            if (p.y > canvas.height) p.y = 0;

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
                if (d < 100) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(79,142,247,${(1 - d / 100) * 0.08})`;
                    ctx.lineWidth = 0.5;
                    ctx.stroke();
                }
            }
        }
        this.rafId = requestAnimationFrame(() => this.animateParticles());
    }

    // ─── ENTRANCE STAGGERED ANIMATIONS ────────────────────────────────────
    private triggerEntranceAnimations(gen: number = 0) {
        // Scope to .main ONLY — never touch sidebar or persistent elements
        const main = document.querySelector('.profile-container .main') as HTMLElement;
        if (!main) return;
        const sel = '.stat-card, .detail-card, .papers-card, .tab-header, .paper-item, .audit-row, .api-row, .scholar-stat, .session-row';
        const animEls = main.querySelectorAll<HTMLElement>(sel);

        animEls.forEach((h, i) => {
            // Disable pointer events during the invisible reset frame only
            h.style.pointerEvents = 'none';
            h.style.opacity = '0';
            h.style.transform = 'translateY(28px)';
            h.style.transition = 'none';

            requestAnimationFrame(() => {
                // If a newer tab-switch happened, bail out immediately
                if (gen !== this._animGen) {
                    h.style.opacity = '1';
                    h.style.transform = 'translateY(0)';
                    h.style.pointerEvents = '';
                    return;
                }
                requestAnimationFrame(() => {
                    h.style.transition =
                        `opacity 0.5s ease ${i * 60}ms, transform 0.5s cubic-bezier(0.16,1,0.3,1) ${i * 60}ms`;
                    h.style.opacity = '1';
                    h.style.transform = 'translateY(0)';
                    // Restore pointer-events after the transition fully ends
                    setTimeout(() => { h.style.pointerEvents = ''; }, 500 + i * 60 + 50);
                });
            });
        });
    }

    // ─── CARD MOUSE-GLOW ──────────────────────────────────────────────────
    private initCardGlow() {
        const attachGlow = () => {
            document.querySelectorAll('.detail-card, .stat-card').forEach(card => {
                const el = card as HTMLElement;
                el.addEventListener('mousemove', (e: Event) => {
                    const me = e as MouseEvent;
                    const rect = el.getBoundingClientRect();
                    el.style.setProperty('--cx', `${me.clientX - rect.left}px`);
                    el.style.setProperty('--cy', `${me.clientY - rect.top}px`);
                });
            });
        };
        setTimeout(attachGlow, 400);
    }

    // ─── SIDEBAR MAGNETIC EFFECT ──────────────────────────────────────────
    private initSidebarMagnetic() {
        document.querySelectorAll('.sb-link').forEach(el => {
            const link = el as HTMLElement;
            link.addEventListener('mousemove', (e: Event) => {
                const me = e as MouseEvent;
                const rect = link.getBoundingClientRect();
                const x = ((me.clientX - rect.left) / rect.width - 0.5) * 8;
                const y = ((me.clientY - rect.top) / rect.height - 0.5) * 8;
                link.style.transform = `translateX(${4 + x}px) translateY(${y}px)`;
            });
            link.addEventListener('mouseleave', () => {
                link.style.transform = '';
            });
        });
    }

    // ─── AVATAR 3D TILT ───────────────────────────────────────────────────
    private initAvatarTilt() {
        const wrap = document.querySelector('.avatar-wrap') as HTMLElement;
        if (!wrap) return;
        wrap.addEventListener('mousemove', (e: Event) => {
            const me = e as MouseEvent;
            const rect = wrap.getBoundingClientRect();
            const rx = ((me.clientY - rect.top - rect.height / 2) / rect.height) * -25;
            const ry = ((me.clientX - rect.left - rect.width / 2) / rect.width) * 25;
            wrap.style.transform = `perspective(300px) rotateX(${rx}deg) rotateY(${ry}deg) scale(1.05)`;
        });
        wrap.addEventListener('mouseleave', () => {
            wrap.style.transform = '';
        });
    }

    // ─── AUTH ─────────────────────────────────────────────────────────────
    logout() { this.authService.logout(); }
    triggerFileUpload() { this.fileInput.nativeElement.click(); }

    onFileSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files[0]) {
            const file = input.files[0];
            if (file.size > 2 * 1024 * 1024) { alert('Image must be less than 2MB'); return; }
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target?.result as string;
                this.profileImage = base64;
                if (this.user?.email) localStorage.setItem(`pfp_${this.user.email}`, base64);
            };
            reader.readAsDataURL(file);
        }
    }

    removePfp() {
        this.profileImage = null;
        if (this.user?.email) localStorage.removeItem(`pfp_${this.user.email}`);
    }

    // ─── DATA ─────────────────────────────────────────────────────────────
    loadPersonalResearch() {
        if (!this.user?.name) return;
        this.isLoadingPapers = true;
        this.paperService.getAuthorStats(this.user.name).subscribe({
            next: (res) => { this.authorStats = res; },
            error: (err) => console.error(err)
        });
        this.paperService.getShardaAuthors(undefined, this.user.name).subscribe({
            next: (res) => {
                this.personalPapers = res.data || [];
                this.allPersonalPapers = [...this.personalPapers];
                this.isLoadingPapers = false;
            },
            error: () => { this.isLoadingPapers = false; }
        });
    }

    loadScholarData() {
        this.isLoadingScholar = true;
        this.paperService.getScholarData().subscribe({
            next: (res) => { this.scholarData = res.data || null; this.isLoadingScholar = false; },
            error: () => { this.isLoadingScholar = false; }
        });
    }

    refreshScholar() {
        this.scholarRefreshMsg = '';
        this.isLoadingScholar = true;
        this.paperService.refreshScholarData().subscribe({
            next: (res) => { this.scholarData = res.data || this.scholarData; this.scholarRefreshMsg = 'Stats refreshed!'; this.isLoadingScholar = false; },
            error: (err) => { this.scholarRefreshMsg = err.error?.error || 'Refresh failed'; this.isLoadingScholar = false; }
        });
    }

    linkScholar() {
        if (!this.scholarLinkUrl) return;
        this.isLinkingScholar = true;
        this.paperService.linkScholarUrl(this.scholarLinkUrl).subscribe({
            next: () => { this.isLinkingScholar = false; this.scholarLinkUrl = ''; setTimeout(() => this.loadScholarData(), 3000); },
            error: (err) => { this.scholarError = err.error?.error || 'Link failed'; this.isLinkingScholar = false; }
        });
    }

    onSearchPapers(event: Event) {
        const q = (event.target as HTMLInputElement).value.toLowerCase();
        if (!q) { this.personalPapers = [...this.allPersonalPapers]; return; }
        this.personalPapers = this.allPersonalPapers.filter(p =>
            p.paperTitle?.toLowerCase().includes(q) ||
            p.sourcePaper?.toLowerCase().includes(q) ||
            p.year?.toString().includes(q)
        );
    }

    updatePassword() {
        if (this.passwordData.password !== this.passwordData.confirmPassword) {
            this.passwordStatus = { type: 'error', message: 'Passwords do not match' }; return;
        }
        if (this.passwordData.password.length < 8) {
            this.passwordStatus = { type: 'error', message: 'Password must be at least 8 characters' }; return;
        }
        this.isUpdatingPassword = true;
        this.passwordStatus = { type: null, message: '' };
        this.authService.updatePassword(this.passwordData).subscribe({
            next: () => {
                this.passwordStatus = { type: 'success', message: 'Password updated successfully!' };
                this.passwordData = { currentPassword: '', password: '', confirmPassword: '' };
                this.isUpdatingPassword = false;
            },
            error: (err) => {
                this.passwordStatus = { type: 'error', message: err.error?.error || 'Failed to update password' };
                this.isUpdatingPassword = false;
            }
        });
    }

    getRoleIcon(role: string): string {
        switch (role) {
            case 'Student': return 'school';
            case 'Researcher': return 'auto_awesome';
            case 'Professor': return 'psychology';
            case 'Administrator': return 'verified_user';
            default: return 'person';
        }
    }

    getRoleColor(role: string): string {
        switch (role) {
            case 'Student': return '#2563eb';
            case 'Researcher': return '#7c3aed';
            case 'Professor': return '#0891b2';
            case 'Administrator': return '#059669';
            default: return '#64748b';
        }
    }

    getRoleGradient(role: string): string {
        switch (role) {
            case 'Student': return 'linear-gradient(135deg,#2563eb,#3b82f6)';
            case 'Researcher': return 'linear-gradient(135deg,#7c3aed,#a78bfa)';
            case 'Professor': return 'linear-gradient(135deg,#0891b2,#22d3ee)';
            case 'Administrator': return 'linear-gradient(135deg,#059669,#34d399)';
            default: return 'linear-gradient(135deg,#64748b,#94a3b8)';
        }
    }

    getInitials(name: string): string {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    }

    getAuditLogs() {
        return [
            { action: 'Login', device: 'Chrome / Windows', date: new Date(Date.now() - 1000 * 60 * 60 * 2) },
            { action: 'Password Change', device: 'Chrome / Windows', date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3) },
            { action: 'Login', device: 'Safari / iPhone', date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5) }
        ];
    }

    getApiKeys() {
        return [
            { name: 'Default Research Key', key: 'sk_res_••••••••••••7a2b', created: '2026-02-15' },
            { name: 'Analytics Integration', key: 'sk_analytics_••••••9c4d', created: '2026-01-10' }
        ];
    }
}
