import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';
import { PaperService } from '../../services/paper.service';
import { ApiResponse } from '../../models/paper.model';
import { NavbarComponent } from '../navbar/navbar.component';

@Component({
  selector: 'app-department-counter',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NavbarComponent],
  templateUrl: './department-counter.component.html',
  styleUrls: ['./department-counter.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DepartmentCounterComponent implements OnInit {
  departments: any[] = [];
  isLoading: boolean = false;
  error: string | null = null;
  searchTerm: string = '';
  sortBy: 'papers' | 'authors' | 'name' = 'papers';
  
  // Stats
  institutionalTotal: number = 0;
  totalPapers: number = 0;
  totalAuthors: number = 0;
  avgPapersPerAuthor: number = 0;

  // UI state for details
  selectedDept: any | null = null;
  activeTab: 'authors' | 'papers' = 'authors';
  modalData: { loading: boolean, authors: any[], papers: any[], error: string | null } = {
    loading: false,
    authors: [],
    papers: [],
    error: null
  };

  constructor(
    private paperService: PaperService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  loadData(force: boolean = false): void {
    this.isLoading = true;
    this.error = null;
    this.cdr.markForCheck();

    this.paperService.getDepartmentApiCounts(force).pipe(take(1)).subscribe({
      next: (response: any) => {
        if (response.success && response.data) {
          const rawData = response.data || [];
          
          // Extract Institutional Total
          const instRecord = rawData.find((d: any) => d.department === '[INSTITUTIONAL_CORE]');
          this.institutionalTotal = instRecord ? instRecord.totalPapers : (this.departments.length > 0 ? 9641 : 0);
          
          // Filter out the special record and keep only real departments
          this.departments = rawData.filter((d: any) => d.department !== '[INSTITUTIONAL_CORE]');
          
          this.calculateStats();
        } else {
          this.error = response.error || 'Failed to load department analytics.';
        }
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading department counts:', err);
        this.error = 'An error occurred while fetching department stats.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  calculateStats(): void {
    this.totalPapers = this.departments.reduce((acc, dept) => acc + dept.totalPapers, 0);
    this.totalAuthors = this.departments.reduce((acc, dept) => acc + dept.authorCount, 0);
    this.avgPapersPerAuthor = this.totalAuthors > 0 ? Number((this.totalPapers / this.totalAuthors).toFixed(2)) : 0;
  }

  get filteredDepartments(): any[] {
    let filtered = this.departments;
    
    if (this.searchTerm) {
      const q = this.searchTerm.toLowerCase().trim();
      filtered = filtered.filter(d => d.department.toLowerCase().includes(q));
    }

    return [...filtered].sort((a, b) => {
      if (this.sortBy === 'papers') return b.totalPapers - a.totalPapers;
      if (this.sortBy === 'authors') return b.authorCount - a.authorCount;
      return a.department.localeCompare(b.department);
    });
  }

  // --- UI Methods ---

  openDetails(dept: any): void {
    this.selectedDept = dept;
    this.activeTab = 'authors';
    this.fetchDeptDetails(dept.department);
  }

  closeDetails(): void {
    this.selectedDept = null;
    this.modalData = { loading: false, authors: [], papers: [], error: null };
  }

  setTab(tab: 'authors' | 'papers'): void {
    this.activeTab = tab;
  }

  fetchDeptDetails(deptName: string): void {
    this.modalData.loading = true;
    this.cdr.markForCheck();

    this.paperService.getDepartmentDetailsFromDb(deptName).pipe(take(1)).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.modalData = {
            loading: false,
            authors: res.data.authors || [],
            papers: res.data.papers || [],
            error: null
          };
        } else {
          this.modalData.error = res.error || 'Failed to load details from database.';
          this.modalData.loading = false;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.modalData.error = 'Database connection error.';
        this.modalData.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  refreshData(): void {
    if (confirm('This will trigger a live Scopus API sync for all authors and papers. This may take up to 30 seconds. Proceed?')) {
      this.loadData(true);
    }
  }

  getMaxPapers(): number {
    if (this.departments.length === 0) return 0;
    return Math.max(...this.departments.map(d => d.totalPapers));
  }

  getPercentage(papers: number): number {
    const max = this.getMaxPapers();
    return max > 0 ? (papers / max) * 100 : 0;
  }
}
