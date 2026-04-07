import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PaperService } from '../../services/paper.service';
import { ConsolidatedPaper, ConsolidatedAuthor, ApiResponse } from '../../models/paper.model';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { AuthorNamePipe } from '../../pipes/author-name.pipe';

import { NavbarComponent } from '../navbar/navbar.component';

@Component({
  selector: 'app-paper-list',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, NavbarComponent, AuthorNamePipe],
  templateUrl: './paper-list.component.html',
  styleUrl: './paper-list.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PaperListComponent implements OnInit, OnDestroy {
  // Papers data (consolidated with up to 3 authors)
  papers: ConsolidatedPaper[] = [];
  allPapers: ConsolidatedPaper[] = []; // Store all papers for client-side filtering

  // Filter options
  departments: string[] = [];
  years: number[] = [];
  paperTypes: string[] = [];

  // Selected filters
  selectedDepartment = 'All';
  selectedYear = '';
  selectedPaperType = 'All';
  searchQuery = '';
  selectedDate = '';

  // Loading and error states
  isLoading = false;
  errorMessage = '';
  totalAuthorCount = 0; // Pre-calculated for performance

  // Pagination state
  currentPage = 1;
  pageSize = 50;
  totalPages = 0;
  totalPapers = 0;
  paginatedPapers: ConsolidatedPaper[] = []; // Pre-calculated property
  showingRange = ''; // Pre-calculated for template
  pageButtons: (number | string)[] = []; // List of page buttons to show (e.g. [1, 2, '...', 7, 8, 9, '...', 183, 184])

  // Paper details popup
  showPaperDetails = false;
  selectedPaper: ConsolidatedPaper | null = null;

  // Filter visibility toggle
  showFilters = false;
  showSearch = false;

  /**
   * Toggle the visibility of the filter parameters
   */
  toggleFilters(): void {
    this.showFilters = !this.showFilters;
    if (this.showFilters) this.showSearch = false; // Close search if filters opened
  }

  /**
   * Toggle the visibility of the search input
   */
  toggleSearch(): void {
    this.showSearch = !this.showSearch;
    if (this.showSearch) this.showFilters = false; // Close filters if search opened
  }

  // Hardcoded list of 25 standard departments
  shardaDepartments: string[] = [
    'department of Computer Science & Engineering',
    'department of Computer Science & Applications',
    'department of Electrical Electronics & Communication Engineering',
    'department of Mechanical Engineering',
    'department of Civil Engineering',
    'department of management',
    'department of business and commerse',
    'department of physics',
    'department of chemistry and biochemistry',
    'department of mathematics',
    'department of life sciences',
    'department of Biotechnology',
    'department of environmental science',
    'department of Humanities & Social Sciences',
    'department of Law',
    'department of Mass Communication',
    'department of art and science',
    'department of Architecture',
    'department of pharmacy',
    'department of allied health science',
    'department of Medical Sciences',
    'department of dental science',
    'department of Nursing Sciences',
    'department of agricultural science',
    'department of education'
  ];

  // Subscription management
  private subscription: Subscription | null = null;
  private searchSubject = new Subject<string>();

  constructor(
    private paperService: PaperService,
    private location: Location,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute
  ) { }

  ngOnInit(): void {
    // Read query params from Dashboard handoff
    this.route.queryParams.subscribe(params => {
      if (params['department']) {
        this.selectedDepartment = params['department'];
        if (!this.shardaDepartments.includes(this.selectedDepartment) && this.selectedDepartment !== 'All') {
          this.shardaDepartments.push(this.selectedDepartment);
        }
      }
      if (params['startDate']) {
        this.selectedDate = params['startDate']; // Best effort fallback for single UI date picker
      }
      this.loadPapers();
    });

    // Setup search debounce
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(() => {
      this.loadPapers();
    });
  }

  ngOnDestroy(): void {
    // Clean up subscriptions
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    this.searchSubject.complete();
  }

  /**
   * Load consolidated papers from the server with filters and pagination
   */
  loadPapers(): void {
    this.isLoading = true;
    this.errorMessage = '';

    const filters: {
      department?: string;
      year?: string;
      paperType?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {
      page: this.currentPage,
      limit: this.pageSize
    };

    if (this.selectedDepartment && this.selectedDepartment !== 'All') {
      filters.department = this.selectedDepartment;
    }
    if (this.selectedYear) {
      filters.year = this.selectedYear;
    }
    if (this.selectedPaperType && this.selectedPaperType !== 'All') {
      filters.paperType = this.selectedPaperType;
    }
    if (this.searchQuery.trim()) {
      filters.search = this.searchQuery.trim();
    }

    this.subscription = this.paperService.getConsolidatedPapers(filters).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success && response.data) {
          this.paginatedPapers = response.data;
          this.totalPapers = response.count || 0;
          this.totalPages = Math.ceil(this.totalPapers / this.pageSize) || 1;
          const startIndex = (this.currentPage - 1) * this.pageSize;
          const end = Math.min(this.currentPage * this.pageSize, this.totalPapers);
          this.showingRange = this.totalPapers > 0 ? `Showing ${startIndex + 1} - ${end} of ${this.totalPapers}` : '';

          // Load filter options from response (only once when no filters applied)
          if (response.filters) {
            if (this.years.length === 0) {
              this.years = response.filters.years;
            }
            if (this.paperTypes.length === 0) {
              this.paperTypes = response.filters.paperTypes;
            }
          }

          this.generatePageButtons();
          this.cdr.markForCheck();
        } else {
          this.errorMessage = response.error || 'Failed to load papers';
          this.cdr.markForCheck();
        }
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || 'Failed to load papers';
        this.cdr.markForCheck();
      }
    });
  }

  /**
   * Handle pagination updates locally (trigger new server load)
   */
  updatePagination(): void {
    this.loadPapers();
  }

  /**
   * Generate the list of page buttons to show with smart truncation
   */
  private generatePageButtons(): void {
    const total = this.totalPages;
    const current = this.currentPage;
    const buttons: (number | string)[] = [];

    if (total <= 7) {
      // Show all pages if there are few
      for (let i = 1; i <= total; i++) buttons.push(i);
    } else {
      // Always show first two pages
      buttons.push(1);
      buttons.push(2);

      if (current > 4) {
        buttons.push('...');
      }

      // Show pages around current
      const start = Math.max(3, current - 1);
      const end = Math.min(total - 2, current + 1);

      for (let i = start; i <= end; i++) {
        if (!buttons.includes(i)) buttons.push(i);
      }

      if (current < total - 3) {
        buttons.push('...');
      }

      // Always show last two pages
      if (!buttons.includes(total - 1)) buttons.push(total - 1);
      if (!buttons.includes(total)) buttons.push(total);
    }

    this.pageButtons = buttons;
  }

  /**
   * Go to next page
   */
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.updatePagination();
      this.scrollToTop();
    }
  }

  /**
   * Go to previous page
   */
  prevPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updatePagination();
      this.scrollToTop();
    }
  }

  /**
   * Go to a specific page
   */
  goToPage(page: number | string): void {
    if (typeof page !== 'number') return;
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updatePagination();
      this.scrollToTop();
    }
  }

  /**
   * Scroll to the top of the results
   */
  private scrollToTop(): void {
    const tableElement = document.querySelector('.table-container');
    if (tableElement) {
      tableElement.scrollTo({ top: 0, behavior: 'instant' });
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * trackBy function for paper list rendering optimization
   */
  trackByPaperId(index: number, paper: ConsolidatedPaper): string {
    return paper._id || paper.id || paper.paperTitle || index.toString();
  }


  /**
   * Handle filter changes
   */
  onFilterChange(): void {
    this.currentPage = 1; // Reset to first page on filter change
    this.loadPapers();
  }

  /**
   * Handle search input with debounce and show results in table
   */
  onSearchInput(): void {
    // Push to subject for debounced loadPapers call
    this.searchSubject.next(this.searchQuery);
  }

  /**
   * Handle changes to local client-side filters (like date or department)
   */
  onLocalFilterChange(): void {
    this.currentPage = 1;
    this.loadPapers();
  }

  /**
   * Scroll to the first matched paper after search results load
   */
  scrollToFirstMatch(): void {
    // Wait for the table to render
    setTimeout(() => {
      // If any row exists, scroll to first row
      const firstRow = document.querySelector('.paper-row');
      if (firstRow) {
        firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  /**
   * Clear filters
   */
  clearFilters(): void {
    this.selectedYear = '';
    this.selectedPaperType = 'All';
    this.searchQuery = '';
    this.selectedDepartment = 'All'; // Also clear department
    this.selectedDate = ''; // Clear date string
    this.loadPapers();
  }

  /**
   * Check if any filters are active
   */
  hasActiveFilters(): boolean {
    return this.selectedYear !== '' ||
      this.selectedPaperType !== 'All' ||
      this.searchQuery.trim() !== '' ||
      this.selectedDepartment !== 'All' ||
      this.selectedDate !== '';
  }

  /**
   * Download consolidated papers as CSV
   */
  downloadCSV(): void {
    this.paperService.downloadConsolidatedCSV();
  }

  /**
   * Clear all papers from the database
   */
  clearAll(): void {
    if (confirm('Are you sure you want to delete all papers?')) {
      this.isLoading = true;

      this.subscription = this.paperService.clearAuthors().subscribe({
        next: (response) => {
          if (response.success) {
            this.papers = [];
            this.allPapers = [];
            this.departments = [];
            this.years = [];
            this.paperTypes = [];
            alert('All papers have been cleared');
          }
          this.isLoading = false;
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = error.error?.message || 'Failed to clear papers';
        }
      });
    }
  }

  /**
   * Navigate to upload page
   */
  goToUpload(): void {
    // Navigate using window for simplicity
    window.location.href = '/upload';
  }


  /**
   * Open paper details popup
   * @param paper - The paper to show details for
   */
  openPaperDetails(paper: ConsolidatedPaper): void {
    this.selectedPaper = paper;
    this.showPaperDetails = true;
  }

  /**
   * Close paper details popup
   */
  closePaperDetails(): void {
    this.showPaperDetails = false;
    this.selectedPaper = null;
  }


  /**
   * Highlight matched text in a string
   * @param text - The text to search in
   * @returns HTML string with matched text highlighted
   */
  highlightMatch(text: string): string {
    if (!this.searchQuery.trim() || !text) {
      return text || '';
    }
    const regex = new RegExp(`(${this.escapeRegExp(this.searchQuery.trim())})`, 'gi');
    return text.replace(regex, '<span class="highlighted">$1</span>');
  }

  /**
   * Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }


  /**
   * Handle department/school selection from dropdown
   * Applies local filter to the loaded papers
   */
  onSchoolSelect(): void {
    this.currentPage = 1; // Reset to first page on school change
    this.loadPapers();
  }

  /**
   * Get additional authors beyond the first 3
   * @param paper - The paper to get additional authors for
   * @returns Array of additional authors (from index 3 onwards)
   */
  getAdditionalAuthors(paper: ConsolidatedPaper): ConsolidatedAuthor[] {
    if (!paper.authors || paper.authors.length <= 3) {
      return [];
    }
    return paper.authors.slice(3);
  }

  /**
   * Format author name from "Last, First" to "First Last"
   * @param name - The name string to format
   */
  formatAuthorName(name: string | undefined | null): string {
    if (!name) return '-';
    if (!name.includes(',')) return name;

    const parts = name.split(',');
    if (parts.length < 2) return name;

    // "Last, First" -> "First Last"
    return `${parts[1].trim()} ${parts[0].trim()}`;
  }

  /**
   * Navigate back to previous page
   */
  goBack(): void {
    this.location.back();
  }

  /**
   * Get the CSS class for a quartile badge
   * @param quartile - The quartile string (Q1, Q2, Q3, Q4)
   * @returns CSS class name
   */
  getQuartileClass(quartile: string | undefined): string {
    if (!quartile) return 'quartile-na';
    const q = quartile.toUpperCase();
    if (q === 'Q1') return 'quartile-q1';
    if (q === 'Q2') return 'quartile-q2';
    if (q === 'Q3') return 'quartile-q3';
    if (q === 'Q4') return 'quartile-q4';
    return 'quartile-na';
  }
}

