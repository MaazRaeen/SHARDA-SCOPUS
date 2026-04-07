import { Routes } from '@angular/router';
import { PaperListComponent } from './components/paper-list/paper-list.component';
import { UploadComponent } from './components/upload/upload.component';
import { ScopusFetchComponent } from './components/scopus-fetch/scopus-fetch.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { LandingComponent } from './components/landing/landing.component';
import { ScopusTableComponent } from './components/scopus-table/scopus-table.component';
import { TeacherUploadComponent } from './components/teacher-upload/teacher-upload.component';
import { TeacherStatisticsComponent } from './components/teacher-statistics/teacher-statistics.component';
import { AuthComponent } from './components/auth/auth.component';
import { ProfileComponent } from './components/profile/profile.component';
import { BlogComponent } from './components/blog/blog.component';
import { AuthorListComponent } from './components/author-list/author-list.component';
import { AuthorApiComponent } from './components/author-api/author-api.component';
import { DepartmentCounterComponent } from './components/department-counter/department-counter.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'auth', component: AuthComponent },
  { path: 'blog', component: BlogComponent, canActivate: [authGuard] },
  { path: 'authors', component: AuthorListComponent, canActivate: [authGuard] },
  { path: 'authors-api', component: AuthorApiComponent, canActivate: [authGuard] },
  { path: 'department-counter', component: DepartmentCounterComponent, canActivate: [authGuard] },
  { path: '', component: LandingComponent },
  { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
  { path: 'upload', component: UploadComponent, canActivate: [authGuard] },
  { path: 'papers', component: PaperListComponent, canActivate: [authGuard] },
  { path: 'scopus-fetch', component: ScopusFetchComponent, canActivate: [authGuard] },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'scopus-table', component: ScopusTableComponent, canActivate: [authGuard] },
  { path: 'teacher-upload', component: TeacherUploadComponent, canActivate: [authGuard] },
  { path: 'teacher-statistics', component: TeacherStatisticsComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
