import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
    selector: 'app-auth',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './auth.component.html',
    styleUrls: ['./auth.component.css']
})
export class AuthComponent {
    isLogin = true;
    isLoading = false;
    errorMessage = '';

    // Form Data
    authData: any = {
        name: '',
        email: '',
        password: '',
        role: 'Researcher',
        designation: '',
        school: '',
        department: '',
        scholarUrl: ''
    };

    roles = [
        { id: 'Researcher', label: 'Researcher', icon: 'auto_awesome', description: 'Publish and analyze research work' },
        { id: 'Professor', label: 'Professor', icon: 'psychology', description: 'Guide students and manage research' },
        { id: 'Administrator', label: 'Administrator', icon: 'verified_user', description: 'Manage platform and users' }
    ];

    designations = ['Dean', 'Head of Department', 'Other'];

    schools = [
        'School of Engineering & Technology',
        'School of Medical & Allied Health Sciences',
        'School of Nursing Sciences & Allied Health',
        'School of Law, Justice & Governance',
        'School of Business Studies',
        'School of Agriculture Sciences',
        'School of Education',
        'School of Computer Science & Engineering',
        'School of Architecture & Planning',
        'School of Journalism, Film & Television'
    ];

    departments = [
        'Computer Science & Engineering',
        'Electronics & Communication Engineering',
        'Mechanical Engineering',
        'Civil Engineering',
        'Electrical Engineering',
        'Information Technology',
        'Biotechnology',
        'Chemistry',
        'Physics',
        'Mathematics',
        'Management Studies',
        'Law',
        'Pharmacy',
        'Nursing',
        'Agriculture',
        'Architecture',
        'Education',
        'Journalism & Mass Communication',
        'Allied Health Sciences',
        'Medical Laboratory Technology',
        'Physiotherapy',
        'Radiology & Imaging Technology',
        'Optometry',
        'Nutrition & Dietetics',
        'Public Health'
    ];

    get showDesignationPicker(): boolean {
        return !this.isLogin && this.authData.role === 'Professor';
    }

    get showSchoolDeptPicker(): boolean {
        return this.showDesignationPicker &&
            (this.authData.designation === 'Dean' || this.authData.designation === 'Head of Department');
    }

    get showScholarField(): boolean {
        return !this.isLogin && this.authData.role === 'Professor' && this.authData.designation === 'Other';
    }

    constructor(private authService: AuthService, private router: Router) { }

    toggleMode(mode: boolean) {
        this.isLogin = mode;
        this.errorMessage = '';
    }

    selectRole(roleId: string) {
        this.authData.role = roleId;
        this.authData.designation = '';
        this.authData.school = '';
        this.authData.department = '';
        this.authData.scholarUrl = '';
    }

    onSubmit() {
        this.isLoading = true;
        this.errorMessage = '';

        if (this.isLogin) {
            this.authService.login({
                email: this.authData.email,
                password: this.authData.password
            }).subscribe({
                next: (res) => {
                    const user = res?.data?.user;
                    if (user && user.role === 'Professor' && user.designation === 'Other') {
                        this.router.navigate(['/blog']);
                    } else {
                        this.router.navigate(['/dashboard']);
                    }
                },
                error: (err) => {
                    this.errorMessage = err.error?.error || 'Login failed. Please check your credentials.';
                    this.isLoading = false;
                }
            });
        } else {
            this.authService.signup(this.authData).subscribe({
                next: (res) => {
                    const user = res?.data?.user || this.authData;
                    if (user && user.role === 'Professor' && user.designation === 'Other') {
                        this.router.navigate(['/blog']);
                    } else {
                        this.router.navigate(['/dashboard']);
                    }
                },
                error: (err) => {
                    this.errorMessage = err.error?.error || 'Signup failed. Please try again.';
                    this.isLoading = false;
                }
            });
        }
    }
}
