import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { PaperService } from '../../services/paper.service';
import { NavbarComponent } from '../navbar/navbar.component';

Chart.register(...registerables);

@Component({
  selector: 'app-department-counter',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, NavbarComponent],
  templateUrl: './department-counter.component.html',
  styleUrls: ['./department-counter.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DepartmentCounterComponent implements OnInit, AfterViewInit, OnDestroy {
  departments: any[] = [];
  isLoading: boolean = false;
  error: string | null = null;
  searchTerm: string = '';
  sortBy: 'papers' | 'authors' | 'name' = 'papers';
  
  // Overall stats
  institutionalTotal: number = 9641;
  totalPapers: number = 0;
  totalAuthors: number = 0;
  avgPapersPerAuthor: number = 0;

  // Chart Canvas view children
  @ViewChild('stackedBarCanvas') stackedBarCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('pieChartCanvas') pieChartCanvas!: ElementRef<HTMLCanvasElement>;

  // Chart instances
  stackedBarChart: Chart | null = null;
  pieChart: Chart | null = null;

  // UI state for details (drill-down)
  selectedDept: any | null = null;
  activeTab: 'authors' | 'papers' = 'papers';
  selectedTypeFilter: string = 'All';
  searchTermPapers: string = '';
  modalData: { loading: boolean, authors: any[], papers: any[], error: string | null } = {
    loading: false,
    authors: [],
    papers: [],
    error: null
  };

  // List of standard publication types
  publicationCategories = ['Articles', 'Reviews', 'Books', 'Book Chapters', 'Conference Papers', 'Other Publications'];

  constructor(
    private paperService: PaperService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  ngAfterViewInit(): void {
    // Charts will be initialized inside loadData after view coordinates are established
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  destroyCharts(): void {
    if (this.stackedBarChart) {
      this.stackedBarChart.destroy();
      this.stackedBarChart = null;
    }
    if (this.pieChart) {
      this.pieChart.destroy();
      this.pieChart = null;
    }
  }

  loadData(force: boolean = false): void {
    this.isLoading = true;
    this.error = null;
    this.cdr.markForCheck();

    // Call getAnalytics to fetch dynamic MongoDB RAM aggregates
    this.paperService.getAnalytics(undefined, undefined, undefined).pipe(take(1)).subscribe({
      next: (response: any) => {
        if (response.success && response.data) {
          const rawData = response.data.departments || [];
          
          // Filter out institutional core or dummy department codes
          this.departments = rawData.filter((d: any) => d.department && d.department !== '[INSTITUTIONAL_CORE]' && d.department !== 'NA');
          
          this.totalPapers = response.data.totalPapers || 0;
          this.totalAuthors = response.data.totalAuthors || 0;
          this.avgPapersPerAuthor = response.data.avgCitations || 0;

          this.cdr.markForCheck();
          
          // Initialize charts with delay to ensure DOM is updated and canvases are visible
          setTimeout(() => {
            this.initStackedBarChart();
            this.initPieChart();
          }, 0);
        } else {
          this.error = response.error || 'Failed to load department analytics.';
        }
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading analytics:', err);
        this.error = 'An error occurred while fetching department stats.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  getOverallPublicationTypes(): { [key: string]: number } {
    const totals: { [key: string]: number } = {
      'Articles': 0,
      'Reviews': 0,
      'Books': 0,
      'Book Chapters': 0,
      'Conference Papers': 0,
      'Other Publications': 0
    };
    this.departments.forEach(d => {
      if (d.publicationTypes) {
        this.publicationCategories.forEach(cat => {
          totals[cat] += (d.publicationTypes[cat] || 0);
        });
      }
    });
    return totals;
  }

  initStackedBarChart(): void {
    if (this.stackedBarChart) {
      this.stackedBarChart.destroy();
    }
    if (!this.stackedBarCanvas) return;

    const ctx = this.stackedBarCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    // Show top 12 departments by total paper count for visual clarity
    const topDepts = this.departments.slice(0, 12);
    const labels = topDepts.map(d => d.department.replace('Department of ', ''));

    const colors = [
      'rgba(99, 102, 241, 0.85)',   // Indigo for Articles
      'rgba(16, 185, 129, 0.85)',   // Emerald for Reviews
      'rgba(245, 158, 11, 0.85)',   // Amber for Books
      'rgba(6, 182, 212, 0.85)',    // Cyan for Book Chapters
      'rgba(236, 72, 153, 0.85)',   // Pink for Conference Papers
      'rgba(148, 163, 184, 0.85)'   // Slate for Others
    ];
    const borderColors = [
      '#6366f1',
      '#10b981',
      '#f59e0b',
      '#06b6d4',
      '#ec4899',
      '#94a3b8'
    ];

    const datasets = this.publicationCategories.map((cat, idx) => ({
      label: cat,
      data: topDepts.map(d => (d.publicationTypes && d.publicationTypes[cat]) || 0),
      backgroundColor: colors[idx],
      borderColor: borderColors[idx],
      borderWidth: 1.5,
      borderRadius: idx === this.publicationCategories.length - 1 ? 4 : 0
    }));

    this.stackedBarChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 15,
              font: { family: "'Outfit', 'Inter', sans-serif", size: 11, weight: 500 },
              color: '#475569'
            }
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleFont: { family: "'Outfit', sans-serif", size: 13, weight: 'bold' },
            bodyFont: { family: "'Inter', sans-serif", size: 11 },
            padding: 12,
            cornerRadius: 10,
            boxPadding: 6
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: {
              font: { family: "'Outfit', sans-serif", size: 10, weight: 500 },
              color: '#64748b',
              maxRotation: 35,
              minRotation: 35
            }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: 'rgba(226, 232, 240, 0.6)' },
            ticks: {
              font: { family: "'Inter', sans-serif", size: 10 },
              color: '#64748b'
            }
          }
        }
      }
    });
  }

  initPieChart(): void {
    if (this.pieChart) {
      this.pieChart.destroy();
    }
    if (!this.pieChartCanvas) return;

    const ctx = this.pieChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    // Use selected department breakdown if drilled down, otherwise use overall totals
    const sourceData = this.selectedDept && this.selectedDept.publicationTypes 
      ? this.selectedDept.publicationTypes
      : this.getOverallPublicationTypes();

    const dataValues = this.publicationCategories.map(cat => sourceData[cat] || 0);
    const total = dataValues.reduce((a, b) => a + b, 0);

    const colors = [
      'rgba(99, 102, 241, 0.8)',
      'rgba(16, 185, 129, 0.8)',
      'rgba(245, 158, 11, 0.8)',
      'rgba(6, 182, 212, 0.8)',
      'rgba(236, 72, 153, 0.8)',
      'rgba(148, 163, 184, 0.8)'
    ];
    const borderColors = [
      '#6366f1',
      '#10b981',
      '#f59e0b',
      '#06b6d4',
      '#ec4899',
      '#94a3b8'
    ];

    this.pieChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: this.publicationCategories,
        datasets: [{
          data: dataValues,
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1.5,
          hoverOffset: 10
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              usePointStyle: true,
              pointStyle: 'circle',
              padding: 12,
              font: { family: "'Outfit', 'Inter', sans-serif", size: 11, weight: 500 },
              color: '#475569'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleFont: { family: "'Outfit', sans-serif", size: 12, weight: 'bold' },
            bodyFont: { family: "'Inter', sans-serif", size: 11 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (context) => {
                const value = context.parsed;
                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                return ` ${context.label}: ${value} (${pct}%)`;
              }
            }
          }
        },
        cutout: '65%'
      }
    });
  }

  get filteredDepartments(): any[] {
    let filtered = this.departments;
    
    if (this.searchTerm) {
      const q = this.searchTerm.toLowerCase().trim();
      filtered = filtered.filter(d => d.department.toLowerCase().includes(q));
    }

    return [...filtered].sort((a, b) => {
      if (this.sortBy === 'papers') return b.paperCount - a.paperCount;
      if (this.sortBy === 'authors') return b.uniqueAuthors - a.uniqueAuthors;
      return a.department.localeCompare(b.department);
    });
  }

  // --- UI Interactions & Drill-down ---

  openDetails(dept: any): void {
    this.selectedDept = dept;
    this.activeTab = 'papers';
    this.selectedTypeFilter = 'All';
    this.searchTermPapers = '';
    this.cdr.markForCheck();
    
    // Fetch publication details using MongoDB RAM endpoint
    this.fetchDeptDetails(dept.department);
  }

  closeDetails(): void {
    this.selectedDept = null;
    this.modalData = { loading: false, authors: [], papers: [], error: null };
    this.selectedTypeFilter = 'All';
    this.searchTermPapers = '';
    
    // Re-draw the pie chart to show overall distribution
    setTimeout(() => this.initPieChart(), 0);
    this.cdr.markForCheck();
  }

  setTab(tab: 'authors' | 'papers'): void {
    this.activeTab = tab;
    this.cdr.markForCheck();
  }

  setTypeFilter(type: string): void {
    this.selectedTypeFilter = type;
    this.cdr.markForCheck();
  }

  fetchDeptDetails(deptName: string): void {
    this.modalData.loading = true;
    this.cdr.markForCheck();

    this.paperService.getDepartmentDetailsMongo(deptName).pipe(take(1)).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.modalData = {
            loading: false,
            authors: res.data.authors || [],
            papers: res.data.papers || [],
            error: null
          };
          
          // Re-draw the pie chart with department-specific values
          setTimeout(() => this.initPieChart(), 0);
        } else {
          this.modalData.error = res.error || 'Failed to load details from database.';
          this.modalData.loading = false;
        }
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error fetching department details:', err);
        this.modalData.error = 'Database connection error.';
        this.modalData.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  refreshData(): void {
    if (confirm('This will trigger a live data refresh from the database buffer. Proceed?')) {
      this.loadData(true);
    }
  }

  getMaxPapers(): number {
    if (this.departments.length === 0) return 0;
    return Math.max(...this.departments.map(d => d.paperCount));
  }

  getPercentage(papers: number): number {
    const max = this.getMaxPapers();
    return max > 0 ? (papers / max) * 100 : 0;
  }

  // Frontend filters for drilled-down papers list
  get filteredModalPapers(): any[] {
    let list = this.modalData.papers || [];

    if (this.selectedTypeFilter !== 'All') {
      list = list.filter(p => {
        const rawType = (p.paperType || 'Other').toLowerCase().trim();
        let mappedType = 'Other Publications';
        if (rawType.includes('article') || rawType === 'journal' || rawType === 'ar') {
          mappedType = 'Articles';
        } else if (rawType.includes('review') || rawType === 're' || rawType === 'short survey') {
          mappedType = 'Reviews';
        } else if (rawType === 'book' || rawType === 'bk' || rawType === 'monograph') {
          mappedType = 'Books';
        } else if (rawType.includes('chapter') || rawType === 'ch') {
          mappedType = 'Book Chapters';
        } else if (rawType.includes('conference') || rawType.includes('proceeding') || rawType === 'cp' || rawType === 'conf') {
          mappedType = 'Conference Papers';
        }
        return mappedType === this.selectedTypeFilter;
      });
    }

    if (this.searchTermPapers) {
      const q = this.searchTermPapers.toLowerCase().trim();
      list = list.filter(p => 
        (p.title && p.title.toLowerCase().includes(q)) || 
        (p.authors && p.authors.toLowerCase().includes(q)) ||
        (p.journal && p.journal.toLowerCase().includes(q))
      );
    }

    return list;
  }
}
