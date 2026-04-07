import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({
    providedIn: 'root'
})
export class AuthService {
    private apiUrl = 'http://localhost:3000/api/auth';
    private userSubject = new BehaviorSubject<any>(null);
    public user$ = this.userSubject.asObservable();

    constructor(private http: HttpClient, private router: Router) {
        const savedUser = localStorage.getItem('user');
        console.log('AuthService: raw user from localStorage:', savedUser);
        if (savedUser && savedUser !== 'undefined' && savedUser !== 'null') {
            try {
                const user = JSON.parse(savedUser);
                console.log('AuthService: parsed user:', user);
                this.userSubject.next(user);
            } catch (e) {
                console.error('AuthService: failed to parse user from localStorage', e);
            }
        } else {
            console.log('AuthService: no valid user found in localStorage');
        }
    }

    signup(userData: any): Observable<any> {
        return this.http.post(`${this.apiUrl}/signup`, userData).pipe(
            tap((res: any) => {
                if (res.success) {
                    this.saveUser(res.data.user, res.token);
                }
            })
        );
    }

    login(credentials: any): Observable<any> {
        return this.http.post(`${this.apiUrl}/login`, credentials).pipe(
            tap((res: any) => {
                if (res.success) {
                    this.saveUser(res.data.user, res.token);
                }
            })
        );
    }

    private saveUser(user: any, token: string) {
        const userData = { ...user, token };
        localStorage.setItem('user', JSON.stringify(userData));
        localStorage.setItem('token', token);
        this.userSubject.next(userData);
    }

    logout() {
        localStorage.removeItem('user');
        localStorage.removeItem('token');
        this.userSubject.next(null);
        this.router.navigate(['/auth']);
    }

    updatePassword(passwordData: any): Observable<any> {
        const token = localStorage.getItem('token');
        return this.http.patch(`${this.apiUrl}/updatePassword`, passwordData, {
            headers: { Authorization: `Bearer ${token}` }
        }).pipe(
            tap((response: any) => {
                if (response.success) {
                    // Update user/token in storage if needed ( createSendToken returns both )
                    localStorage.setItem('token', response.token);
                    localStorage.setItem('user', JSON.stringify(response.data.user));
                    this.userSubject.next(response.data.user);
                }
            })
        );
    }

    isLoggedIn(): boolean {
        return !!this.userSubject.value;
    }

    getUserRole(): string {
        return this.userSubject.value?.role || '';
    }

    getCurrentUser(): any {
        return this.userSubject.value;
    }
}
