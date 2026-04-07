import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaperService } from '../../services/paper.service';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';
import { ApiResponse } from '../../models/paper.model';

@Component({
  selector: 'app-author-api',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './author-api.component.html',
  styleUrls: ['./author-api.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuthorApiComponent implements OnInit {
  authors: any[] = [];
  totalResults: number = 0;
  startIndex: number = 0;
  itemsPerPage: number = 100;
  isLoading: boolean = false;
  error: string | null = null;
  searchTerm: string = '';

  // Publication Modal State
  showPapersModal: boolean = false;
  isModalLoading: boolean = false;
  selectedAuthorPapers: any[] = [];
  selectedAuthorName: string = '';
  selectedAuthorId: string = '';
  modalError: string | null = null;
  
  // Modal Pagination
  modalStartIndex: number = 0;
  modalItemsPerPage: number = 50;
  modalTotalResults: number = 0;

  constructor(
    private paperService: PaperService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  viewAuthorPapers(author: any): void {
    this.selectedAuthorId = this.getAuthorId(author);
    this.selectedAuthorName = this.formatName(author);
    this.showPapersModal = true;
    this.loadModalData(0);
  }

  loadModalData(start: number): void {
    this.isModalLoading = true;
    this.modalStartIndex = start;
    this.selectedAuthorPapers = [];
    this.modalError = null;
    this.cdr.markForCheck();

    this.paperService.getAuthorPapersFromApi(this.selectedAuthorId, start, this.modalItemsPerPage).pipe(take(1)).subscribe({
      next: (response: ApiResponse<any[]>) => {
        if (response.success) {
          this.selectedAuthorPapers = response.data || [];
          this.modalTotalResults = response.totalResults || 0;
        } else {
          this.modalError = response.message || 'Failed to fetch papers';
        }
        this.isModalLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error fetching author papers:', err);
        this.modalError = 'Direct API request failed. Please try again later.';
        this.isModalLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  modalNextPage(): void {
    if (this.modalStartIndex + this.modalItemsPerPage < this.modalTotalResults) {
      this.loadModalData(this.modalStartIndex + this.modalItemsPerPage);
    }
  }

  modalPrevPage(): void {
    if (this.modalStartIndex > 0) {
      const prevStart = Math.max(0, this.modalStartIndex - this.modalItemsPerPage);
      this.loadModalData(prevStart);
    }
  }

  closeModal(): void {
    this.showPapersModal = false;
    this.selectedAuthorPapers = [];
    this.selectedAuthorName = '';
    this.selectedAuthorId = '';
    this.modalError = null;
    this.modalStartIndex = 0;
    this.modalTotalResults = 0;
  }

  onSearch(): void {
    this.loadData(0);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.loadData(0);
  }

  loadData(start: number = 0): void {
    this.isLoading = true;
    this.error = null;
    this.cdr.markForCheck();

    this.paperService.getAuthorsFromApi(start, this.itemsPerPage, this.searchTerm).pipe(take(1)).subscribe({
      next: (response: ApiResponse<any[]>) => {
        if (response.success && response.data) {
          this.authors = response.data || [];
          this.totalResults = response.totalResults ?? 0;
          this.startIndex = response.startIndex ?? 0;
        } else {
          this.error = response.error || 'Failed to load authors from API.';
        }
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading authors from API:', err);
        this.error = 'An error occurred while fetching authors from Scopus API.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  nextPage(): void {
    if (this.startIndex + this.itemsPerPage < this.totalResults) {
      this.loadData(this.startIndex + this.itemsPerPage);
    }
  }

  prevPage(): void {
    if (this.startIndex - this.itemsPerPage >= 0) {
      this.loadData(this.startIndex - this.itemsPerPage);
    }
  }

  get currentPage(): number {
    return Math.floor(this.startIndex / this.itemsPerPage) + 1;
  }

  get totalPages(): number {
    return Math.ceil(this.totalResults / this.itemsPerPage);
  }

  getScopusUrl(scopusId: string): string {
    const id = scopusId.replace('AUTHOR_ID:', '');
    return `https://www.scopus.com/authid/detail.uri?authorId=${id}`;
  }

  formatName(author: any): string {
    const preferredName = author['preferred-name'];
    if (!preferredName) return 'Unknown Author';
    
    const surname = preferredName.surname || '';
    const givenName = preferredName['given-name'] || '';
    const initials = preferredName.initials || '';
    
    return `${givenName} ${surname}`.trim() || `${initials} ${surname}`.trim() || surname || 'Unknown Author';
  }

  getAuthorId(author: any): string {
    return author['dc:identifier']?.replace('AUTHOR_ID:', '') || '';
  }

  getAffiliation(author: any): string {
    return author['affiliation-current']?.['affiliation-name'] || 'N/A';
  }

  downloadCSV(): void {
    if (!this.authors.length) return;
    
    const headers = ['Author Name', 'Scopus ID', 'Current Affiliation'];
    const rows = this.authors.map(author => {
      const name = this.formatName(author).replace(/"/g, '""');
      const scopusId = this.getAuthorId(author);
      const affiliation = this.getAffiliation(author).replace(/"/g, '""');
      return `"${name}","${scopusId}","${affiliation}"`;
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `scopus_authors_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
