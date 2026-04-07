import { Component, Input, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule, Location } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
    selector: 'app-navbar',
    standalone: true,
    imports: [CommonModule, RouterLink, RouterLinkActive],
    templateUrl: './navbar.component.html',
    styleUrls: ['./navbar.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class NavbarComponent implements OnInit {
    @Input() showBackButton: boolean = false;
    isMenuOpen = false;
    user: any = null;
    profileImage: string | null = null;

    constructor(private location: Location, private authService: AuthService) { }

    ngOnInit(): void {
        this.authService.user$.subscribe(userData => {
            this.user = userData;
            if (userData?.email) {
                this.profileImage = localStorage.getItem(`pfp_${userData.email}`);
            } else {
                this.profileImage = null;
            }
        });
    }

    goBack() {
        this.location.back();
    }

    logout() {
        this.authService.logout();
        this.closeMenu();
    }

    toggleMenu() {
        this.isMenuOpen = !this.isMenuOpen;
    }

    closeMenu() {
        this.isMenuOpen = false;
    }
}
