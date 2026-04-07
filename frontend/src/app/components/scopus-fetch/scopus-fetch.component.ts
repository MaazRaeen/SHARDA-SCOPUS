import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ScopusService } from '../../services/scopus.service';
import { ConsolidatedPaper, ConsolidatedAuthor, ScopusSearchParams } from '../../models/paper.model';
import { NavbarComponent } from '../navbar/navbar.component';

@Component({
  selector: 'app-scopus-fetch',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NavbarComponent],
  templateUrl: './scopus-fetch.component.html',
  styleUrl: './scopus-fetch.component.css'
})
export class ScopusFetchComponent implements OnInit {
  // API Configuration
  apiKey: string = '';
  useCustomApiKey: boolean = false;

  // Search parameters
  searchQuery: string = '';
  affiliation: string = 'Sharda University';
  dateFrom: string = '';
  dateTo: string = '';
  paperType: string = 'All';
  maxResults: number = 100;

  // Results
  papers: ConsolidatedPaper[] = [];
  totalResults: number = 0;

  // UI States
  isLoading = false;
  isSearching = false;
  errorMessage: string = '';
  successMessage: string = '';

  // Filter options
  years: number[] = [];
  paperTypes: string[] = ['All', 'Article', 'Review', 'Conference Paper', 'Book Chapter', 'Book', 'Editorial'];

  // Static years list for broader filtering options
  staticYears: number[] = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010];

  // Selected filters
  selectedYear = '';
  selectedPaperType = 'All';
  selectedDepartment = '';
  departments: string[] = [];

  // Pagination state
  currentStartIndex: number = 0;
  itemsPerPage: number = 100;
  isLoadingMore: boolean = false;
  allLoadedPapers: ConsolidatedPaper[] = [];

  // Computed pagination properties
  get displayedStart(): number {
    return this.allLoadedPapers.length > 0 ? 1 : 0;
  }

  get displayedEnd(): number {
    return this.allLoadedPapers.length;
  }

  get hasMoreResults(): boolean {
    return this.allLoadedPapers.length < this.totalResults;
  }

  get canLoadMore(): boolean {
    return this.hasMoreResults && !this.isLoadingMore;
  }

  get currentPage(): number {
    return Math.floor(this.currentStartIndex / this.itemsPerPage) + 1;
  }

  get totalPages(): number {
    return Math.ceil(this.totalResults / this.itemsPerPage);
  }

  constructor(private scopusService: ScopusService, private location: Location) { }

  ngOnInit(): void {
    // Load saved API key if exists
    const savedApiKey = localStorage.getItem('scopus_api_key');
    if (savedApiKey) {
      this.apiKey = savedApiKey;
      this.useCustomApiKey = true;
    } else {
      // Load default API key from backend
      this.loadDefaultApiKey();
    }
  }

  /**
   * Load default API key from backend
   */
  private loadDefaultApiKey(): void {
    this.scopusService.getDefaultApiKey().subscribe({
      next: (response: { success: boolean; apiKey?: string; error?: string }) => {
        if (response.success && response.apiKey) {
          this.apiKey = response.apiKey;
          this.scopusService.setApiKey(response.apiKey);
        }
      },
      error: (error: any) => {
        console.warn('Could not load default Scopus API key:', error);
      }
    });
  }

  /**
   * Search Scopus for papers (initial search)
   */
  searchScopus(): void {
    if (!this.validateInputs()) {
      return;
    }

    // Save API key if custom
    if (this.useCustomApiKey && this.apiKey.trim()) {
      localStorage.setItem('scopus_api_key', this.apiKey.trim());
    }

    // Ensure API key is set on the service
    this.scopusService.setApiKey(this.apiKey);

    this.isSearching = true;
    this.errorMessage = '';

    // Reset pagination state for new search
    this.allLoadedPapers = [];
    this.papers = [];
    this.currentStartIndex = 0;
    this.isLoadingMore = false;

    const params: ScopusSearchParams = {
      query: this.buildQuery(),
      maxResults: this.maxResults
    };

    // Use searchPapers which extracts department names from Scopus API affiliation data
    this.scopusService.searchPapers(params, 0).subscribe({
      next: (response) => {
        this.isSearching = false;
        if (response.success && response.data) {
          this.allLoadedPapers = response.data;
          this.papers = [...this.allLoadedPapers];
          this.totalResults = response.total || response.data.length;
          this.itemsPerPage = response.itemsPerPage || this.maxResults;
          this.currentStartIndex = 0;

          // Log for debugging
          console.log(`Search completed: ${this.papers.length} papers loaded`);
          if (this.papers.length > 0) {
            console.log('First paper authors:', this.papers[0].authors);
          }

          // Extract filter options
          this.extractFilterOptions();

          this.successMessage = `Found ${this.totalResults} papers from ${this.affiliation}. Showing ${this.displayedStart}-${this.displayedEnd}.`;
          setTimeout(() => this.successMessage = '', 5000);
        } else {
          this.errorMessage = response.error || 'Failed to fetch papers from Scopus';
        }
      },
      error: (error) => {
        this.isSearching = false;
        this.errorMessage = error.error?.message || error.message || 'Failed to fetch papers from Scopus';
        console.error('Scopus search error:', error);
      }
    });
  }

  /**
   * Load more papers (pagination)
   * Fetches the next batch of papers from Scopus
   */
  loadMore(): void {
    if (this.isLoadingMore || !this.hasMoreResults) {
      return;
    }

    this.isLoadingMore = true;
    this.errorMessage = '';

    const nextStartIndex = this.currentStartIndex + this.itemsPerPage;
    const params: ScopusSearchParams = {
      query: this.buildQuery(),
      maxResults: this.maxResults
    };

    // Use searchPapers which extracts department names from Scopus API affiliation data
    this.scopusService.searchPapers(params, nextStartIndex).subscribe({
      next: (response) => {
        this.isLoadingMore = false;
        if (response.success && response.data) {
          // Accumulate papers
          const newPapers = response.data;
          this.allLoadedPapers = [...this.allLoadedPapers, ...newPapers];
          this.papers = [...this.allLoadedPapers];
          this.currentStartIndex = nextStartIndex;
          this.itemsPerPage = response.itemsPerPage || this.itemsPerPage;

          // Update success message
          this.successMessage = `Loaded ${newPapers.length} more papers. Showing ${this.displayedStart}-${this.displayedEnd} of ${this.totalResults}.`;
          setTimeout(() => this.successMessage = '', 3000);
        } else {
          this.errorMessage = response.error || 'Failed to load more papers';
        }
      },
      error: (error) => {
        this.isLoadingMore = false;
        this.errorMessage = error.error?.message || error.message || 'Failed to load more papers';
        console.error('Scopus load more error:', error);
      }
    });
  }

  /**
   * Load all remaining papers at once
   * Convenience method to load all papers without pagination
   */
  loadAllPapers(): void {
    if (this.isLoadingMore || !this.hasMoreResults) {
      return;
    }

    const remainingCount = this.totalResults - this.allLoadedPapers.length;
    if (remainingCount <= 0) {
      return;
    }

    this.isLoadingMore = true;
    this.errorMessage = '';

    const params: ScopusSearchParams = {
      query: this.buildQuery(),
      maxResults: remainingCount
    };

    // Use searchPapers which extracts department names from Scopus API affiliation data
    this.scopusService.searchPapers(params, this.currentStartIndex + this.itemsPerPage).subscribe({
      next: (response) => {
        this.isLoadingMore = false;
        if (response.success && response.data) {
          // Accumulate all remaining papers
          const newPapers = response.data;
          this.allLoadedPapers = [...this.allLoadedPapers, ...newPapers];
          this.papers = [...this.allLoadedPapers];
          this.currentStartIndex = this.totalResults - this.itemsPerPage; // Approximate

          this.successMessage = `Loaded all ${this.totalResults} papers!`;
          setTimeout(() => this.successMessage = '', 3000);
        } else {
          this.errorMessage = response.error || 'Failed to load all papers';
        }
      },
      error: (error) => {
        this.isLoadingMore = false;
        this.errorMessage = error.error?.message || error.message || 'Failed to load all papers';
        console.error('Scopus load all error:', error);
      }
    });
  }

  /**
   * Build the Scopus query string
   */
  private buildQuery(): string {
    let query = '';

    // Automatically use expanded query for the exact phrase "Sharda University" to closely mimic AF-ID (9,317 results)
    if (this.affiliation.trim().toLowerCase() === 'sharda university') {
      query = `(AFFIL("Sharda University") OR AFFIL("Sharda Univ") OR AFFIL("Sharda Hospital"))`;
    } else {
      query = `AFFIL("${this.affiliation}")`;
    }

    if (this.searchQuery.trim()) {
      query += ` AND TITLE-ABS-KEY("${this.searchQuery}")`;
    }

    // Handle date range with PUBYEAR for better compatibility
    if (this.dateFrom) {
      const yearFrom = this.dateFrom.split('-')[0];
      query += ` AND PUBYEAR > ${parseInt(yearFrom) - 1}`;
    }

    if (this.dateTo) {
      const yearTo = this.dateTo.split('-')[0];
      query += ` AND PUBYEAR < ${parseInt(yearTo) + 1}`;
    }

    if (this.paperType !== 'All') {
      // Mapping paper type labels to Scopus abbreviations
      const typeMap: { [key: string]: string } = {
        'Article': 'ar',
        'Review': 're',
        'Conference Paper': 'cp',
        'Book Chapter': 'ch',
        'Book': 'bk',
        'Editorial': 'ed'
      };
      const typeCode = typeMap[this.paperType] || this.paperType;
      query += ` AND DOCTYPE(${typeCode})`;
    }

    return query;
  }

  /**
   * Validate input parameters
   */
  private validateInputs(): boolean {
    if (!this.useCustomApiKey && !this.apiKey.trim()) {
      this.errorMessage = 'Please enter a Scopus API key';
      return false;
    }

    if (!this.affiliation.trim()) {
      this.errorMessage = 'Please enter an affiliation name';
      return false;
    }

    return true;
  }

  /**
   * Extract filter options from results
   */
  private extractFilterOptions(): void {
    // Extract years
    const yearSet = new Set<number>();
    const papersWithYears: number[] = [];

    this.papers.forEach((paper, index) => {
      console.log(`Paper ${index}: year=${paper.year}, title=${paper.paperTitle?.substring(0, 50)}`);
      if (paper.year) {
        yearSet.add(paper.year);
        papersWithYears.push(paper.year);
      }
    });

    this.years = Array.from(yearSet).sort((a, b) => b - a);
    console.log('Papers with years:', papersWithYears);
    console.log('Unique years extracted:', this.years);
    console.log('Total papers:', this.papers.length);
    console.log('Papers with year:', papersWithYears.length);

    // Extract departments from all authors in all papers
    const deptSet = new Set<string>();
    this.allLoadedPapers.forEach(paper => {
      paper.authors?.forEach(author => {
        if (author.department) {
          deptSet.add(author.department);
        }
      });
    });
    this.departments = Array.from(deptSet).sort();
    console.log('Extracted departments:', this.departments);

    // Extract paper types
    const typeSet = new Set<string>();
    this.papers.forEach(paper => {
      if (paper.paperType) {
        typeSet.add(paper.paperType);
      }
    });
    this.paperTypes = ['All', ...Array.from(typeSet)].sort();
    console.log('Extracted paper types:', this.paperTypes);
  }


  /**
   * Apply local filters to results
   * Always filters from allLoadedPapers to avoid accumulating filter effects
   */
  applyFilters(): void {
    let filtered = [...this.allLoadedPapers];

    if (this.selectedYear) {
      filtered = filtered.filter(p => p.year === parseInt(this.selectedYear));
    }

    if (this.selectedPaperType !== 'All') {
      filtered = filtered.filter(p => p.paperType === this.selectedPaperType);
    }

    if (this.selectedDepartment) {
      filtered = filtered.filter(p =>
        p.authors?.some(author => author.department === this.selectedDepartment)
      );
    }

    this.papers = filtered;
  }



  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.selectedYear = '';
    this.selectedPaperType = 'All';
    this.selectedDepartment = '';
    // Restore papers from allLoadedPapers instead of re-fetching
    this.papers = [...this.allLoadedPapers];
  }


  /**
   * Check if any filters are active
   */
  hasActiveFilters(): boolean {
    return this.selectedYear !== '' || this.selectedPaperType !== 'All' || this.selectedDepartment !== '';
  }

  /**
   * Get total authors count
   */
  getTotalAuthors(): number {
    return this.papers.reduce((total, paper) => total + (paper.authorCount || 0), 0);
  }

  /**
   * Clear API key from storage
   */
  clearApiKey(): void {
    localStorage.removeItem('scopus_api_key');
    this.apiKey = '';
    this.useCustomApiKey = false;
  }

  /**
   * Reset form
   */
  resetForm(): void {
    this.searchQuery = '';
    this.dateFrom = '';
    this.dateTo = '';
    this.paperType = 'All';
    this.selectedDepartment = '';
    this.maxResults = 100;
    this.papers = [];
    this.errorMessage = '';
    this.successMessage = '';
  }

  /**
   * Save papers to database
   */
  saveToDatabase(): void {
    if (this.papers.length === 0) {
      this.errorMessage = 'No papers to save';
      return;
    }

    this.isLoading = true;

    this.scopusService.savePapers(this.papers).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success) {
          this.successMessage = `Successfully saved ${response.count} papers to database`;
          setTimeout(() => this.successMessage = '', 5000);
        } else {
          this.errorMessage = response.error || 'Failed to save papers';
        }
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || 'Failed to save papers';
      }
    });
  }

  /**
   * Navigate to paper list
   */
  goToPaperList(): void {
    window.location.href = '/papers';
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
}

