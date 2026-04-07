import { Component, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ScopusService } from '../../services/scopus.service';
import { ConsolidatedPaper, ScopusSearchParams } from '../../models/paper.model';
import { NavbarComponent } from '../navbar/navbar.component';

@Component({
  selector: 'app-scopus-table',
  imports: [CommonModule, NavbarComponent],
  templateUrl: './scopus-table.component.html',
  styleUrl: './scopus-table.component.css'
})
export class ScopusTableComponent implements OnInit {
  // Data properties
  papers: ConsolidatedPaper[] = [];
  totalResults: number = 0;

  // UI states
  isLoading: boolean = false;
  errorMessage: string = '';

  constructor(private scopusService: ScopusService, private location: Location) { }

  ngOnInit(): void {
    this.loadPapers();
  }

  /**
   * Load papers from Scopus API
   */
  private loadPapers(): void {
    this.isLoading = true;
    this.errorMessage = '';

    // Fetch the API key from the backend first
    this.scopusService.getDefaultApiKey().subscribe({
      next: (res) => {
        if (res.success && res.apiKey) {
          this.scopusService.setApiKey(res.apiKey);
          this.executeSearch();
        } else {
          this.isLoading = false;
          this.errorMessage = res.error || 'Failed to retrieve Scopus API key from server';
        }
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = 'Error fetching API configuration';
        console.error('API key fetch error:', err);
      }
    });
  }

  /**
   * Execute the actual search once API key is ready
   */
  private executeSearch(): void {
    const params: ScopusSearchParams = {
      query: 'affil(Sharda University)',
      maxResults: 100
    };

    // Use searchPapersWithDepartments to get department data from database
    this.scopusService.searchPapersWithDepartments(params).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success && response.data) {
          this.papers = response.data;
          this.totalResults = response.total || response.data.length;

          // Log to verify department data is being fetched
          if (this.papers.length > 0 && this.papers[0].authors.length > 0) {
            console.log('First paper first author:', this.papers[0].authors[0]);
          }
        } else {
          this.errorMessage = response.error || 'Failed to fetch papers from Scopus';
        }
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage = error.error?.message || error.message || 'Failed to fetch papers from Scopus';
        console.error('Scopus API error:', error);
      }
    });
  }

  /**
   * Refresh data from API
   */
  refreshData(): void {
    this.loadPapers();
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
