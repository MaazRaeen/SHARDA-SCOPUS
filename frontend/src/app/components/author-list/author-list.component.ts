import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PaperService } from '../../services/paper.service';
import { ShardaAuthor } from '../../models/paper.model';
import { AuthorNamePipe } from '../../pipes/author-name.pipe';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-author-list',
  standalone: true,
  imports: [CommonModule, FormsModule, AuthorNamePipe, RouterLink],
  templateUrl: './author-list.component.html',
  styleUrls: ['./author-list.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuthorListComponent implements OnInit {
  authors: ShardaAuthor[] = [];
  filteredAuthors: ShardaAuthor[] = [];
  departments: string[] = [];
  
  searchQuery: string = '';
  selectedDepartment: string = 'All';
  isLoading: boolean = true;
  error: string | null = null;

  constructor(
    private paperService: PaperService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadData();
    this.loadDepartments();
  }

  loadData(): void {
    this.isLoading = true;
    this.error = null;
    this.cdr.markForCheck();

    this.paperService.getShardaAuthors().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.authors = response.data;
          this.applyFilters();
        } else {
          this.error = response.error || 'Failed to load authors.';
        }
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading authors:', err);
        this.error = 'An error occurred while fetching authors.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadDepartments(): void {
    this.paperService.getDepartments().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          this.departments = response.data;
          this.cdr.markForCheck();
        }
      }
    });
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  applyFilters(): void {
    let filtered = [...this.authors];

    // Filter by department
    if (this.selectedDepartment !== 'All') {
      filtered = filtered.filter(a => a.department === this.selectedDepartment);
    }

    // Filter by search query
    if (this.searchQuery.trim()) {
      const query = this.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(a => 
        a.authorName.toLowerCase().includes(query) || 
        (a.scopusId && a.scopusId.includes(query))
      );
    }

    // Sort by name
    filtered.sort((a, b) => a.authorName.localeCompare(b.authorName));

    this.filteredAuthors = filtered;
    this.cdr.markForCheck();
  }

  getScopusUrl(scopusId: string): string {
    return `https://www.scopus.com/authid/detail.uri?authorId=${scopusId}`;
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.applyFilters();
  }

  downloadCSV(): void {
    if (!this.filteredAuthors.length) return;
    
    const headers = ['Author Name', 'Department', 'Scopus ID'];
    const rows = this.filteredAuthors.map(author => {
      const name = author.authorName.replace(/"/g, '""');
      const dept = (author.department || 'N/A').replace(/"/g, '""');
      const scopusId = author.scopusId || 'N/A';
      return `"${name}","${dept}","${scopusId}"`;
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `sharda_authors_directory_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
