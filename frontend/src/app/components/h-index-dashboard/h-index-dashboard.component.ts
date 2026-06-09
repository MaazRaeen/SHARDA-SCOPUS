import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Chart, registerables } from 'chart.js';
import { take } from 'rxjs/operators';
import { PaperService } from '../../services/paper.service';
import { NavbarComponent } from '../navbar/navbar.component';
import { ApiResponse } from '../../models/paper.model';

Chart.register(...registerables);

@Component({
  selector: 'app-h-index-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, NavbarComponent],
  templateUrl: './h-index-dashboard.component.html',
  styleUrls: ['./h-index-dashboard.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HIndexDashboardComponent implements OnInit, AfterViewInit, OnDestroy {
  isLoading: boolean = false;
  data: any = null;

  // Filter States
  selectedDepartment: string = 'All';
  selectedCategory: string = 'All';
  startYear: number = 2015;
  endYear: number = 2026;

  // Filter dropdown lists
  departmentsList: string[] = [];
  categoriesList: string[] = ['Articles', 'Reviews', 'Books', 'Book Chapters', 'Conference Papers', 'Other Publications'];
  yearsList: number[] = [];

  // Toggle for growth chart metric
  growthMetric: 'hIndex' | 'totalCitations' | 'paperCount' = 'hIndex';

  // Chart Canvas Elements
  @ViewChild('growthChartCanvas') growthChartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('deptHIndexChartCanvas') deptHIndexChartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('bubbleChartCanvas') bubbleChartCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('distChartCanvas') distChartCanvas!: ElementRef<HTMLCanvasElement>;

  // Chart Instances
  growthChart: Chart | null = null;
  deptHIndexChart: Chart | null = null;
  bubbleChart: Chart | null = null;
  distChart: Chart | null = null;

  constructor(
    private paperService: PaperService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.generateYearsList();
    this.loadData();
  }

  ngAfterViewInit(): void {
    // Canvas items rendered, charts will be initialized when data arrives
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  generateYearsList(): void {
    const currentYear = new Date().getFullYear();
    const start = 2010;
    this.yearsList = [];
    for (let y = currentYear; y >= start; y--) {
      this.yearsList.push(y);
    }
    // Make sure default years are within range
    if (!this.yearsList.includes(this.startYear)) this.startYear = this.yearsList[this.yearsList.length - 1];
    if (!this.yearsList.includes(this.endYear)) this.endYear = currentYear;
  }

  loadData(): void {
    this.isLoading = true;
    this.cdr.markForCheck();

    const startDateStr = `${this.startYear}-01-01`;
    const endDateStr = `${this.endYear}-12-31`;

    this.paperService.getHIndexAnalytics(
      this.selectedDepartment,
      startDateStr,
      endDateStr,
      this.selectedCategory
    ).pipe(take(1)).subscribe({
      next: (res: ApiResponse<any>) => {
        if (res.success && res.data) {
          this.data = res.data;
          
          // Populate unique departments dynamically from backend response
          if (res.data.filterDepartments) {
            this.departmentsList = res.data.filterDepartments;
          }
          
          this.cdr.markForCheck();
          
          // Re-draw charts in next tick after templates update
          setTimeout(() => {
            this.initCharts();
          }, 0);
        }
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Error loading H-Index analytics data:', err);
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onFilterChange(): void {
    // Check if start year is greater than end year
    if (this.startYear > this.endYear) {
      const temp = this.startYear;
      this.startYear = this.endYear;
      this.endYear = temp;
    }
    this.loadData();
  }

  resetFilters(): void {
    this.selectedDepartment = 'All';
    this.selectedCategory = 'All';
    this.startYear = 2015;
    this.endYear = new Date().getFullYear();
    this.loadData();
  }

  setGrowthMetric(metric: 'hIndex' | 'totalCitations' | 'paperCount'): void {
    this.growthMetric = metric;
    this.initGrowthChart();
  }

  // --- Chart.js Draw Actions ---

  destroyCharts(): void {
    if (this.growthChart) {
      this.growthChart.destroy();
      this.growthChart = null;
    }
    if (this.deptHIndexChart) {
      this.deptHIndexChart.destroy();
      this.deptHIndexChart = null;
    }
    if (this.bubbleChart) {
      this.bubbleChart.destroy();
      this.bubbleChart = null;
    }
    if (this.distChart) {
      this.distChart.destroy();
      this.distChart = null;
    }
  }

  initCharts(): void {
    this.destroyCharts();
    this.initGrowthChart();
    this.initDeptHIndexChart();
    this.initBubbleChart();
    this.initDistChart();
  }

  initGrowthChart(): void {
    if (this.growthChart) {
      this.growthChart.destroy();
      this.growthChart = null;
    }
    if (!this.growthChartCanvas || !this.data || !this.data.growthTrend) return;

    const ctx = this.growthChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const trend = this.data.growthTrend;
    const labels = trend.map((g: any) => g.year);
    
    let datasetLabel = '';
    let datasetData: number[] = [];
    let strokeColor = '';
    let fillColor = '';

    if (this.growthMetric === 'hIndex') {
      datasetLabel = 'H-Index';
      datasetData = trend.map((g: any) => g.hIndex);
      strokeColor = '#6366f1'; // Indigo
      fillColor = 'rgba(99, 102, 241, 0.05)';
    } else if (this.growthMetric === 'totalCitations') {
      datasetLabel = 'Citations';
      datasetData = trend.map((g: any) => g.totalCitations);
      strokeColor = '#10b981'; // Emerald
      fillColor = 'rgba(16, 185, 129, 0.05)';
    } else {
      datasetLabel = 'Publications';
      datasetData = trend.map((g: any) => g.paperCount);
      strokeColor = '#f59e0b'; // Amber
      fillColor = 'rgba(245, 158, 11, 0.05)';
    }

    this.growthChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: datasetLabel,
          data: datasetData,
          borderColor: strokeColor,
          backgroundColor: fillColor,
          fill: true,
          tension: 0.3,
          borderWidth: 3,
          pointBackgroundColor: strokeColor,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            titleFont: { family: "'Outfit', sans-serif", weight: 'bold' },
            bodyFont: { family: "'Inter', sans-serif" }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: "'Inter', sans-serif" }, color: '#64748b' }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f1f5f9' },
            ticks: { font: { family: "'Inter', sans-serif" }, color: '#64748b' }
          }
        }
      }
    });
  }

  initDeptHIndexChart(): void {
    if (!this.deptHIndexChartCanvas || !this.data || !this.data.departmentsRanking) return;

    const ctx = this.deptHIndexChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    // Rank top 10 departments
    const ranked = this.data.departmentsRanking.slice(0, 10);
    const labels = ranked.map((d: any) => d.department.replace('Department of ', ''));
    const hIndexes = ranked.map((d: any) => d.hIndex);

    this.deptHIndexChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          data: hIndexes,
          backgroundColor: 'rgba(124, 58, 237, 0.8)', // Violet
          borderColor: '#7c3aed',
          borderWidth: 1.5,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y', // Horizontal bars
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.9)',
            callbacks: {
              label: (context) => ` H-Index: ${context.raw}`
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { font: { family: "'Inter', sans-serif" }, color: '#64748b' },
            grid: { color: '#f1f5f9' }
          },
          y: {
            ticks: { font: { family: "'Outfit', sans-serif", weight: 500, size: 11 }, color: '#475569' },
            grid: { display: false }
          }
        }
      }
    });
  }

  initBubbleChart(): void {
    if (!this.bubbleChartCanvas || !this.data || !this.data.departmentsRanking) return;

    const ctx = this.bubbleChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const ranked = this.data.departmentsRanking;
    
    // Bubble format: { x: papers, y: hIndex, r: citationCountMapped }
    const bubbleData = ranked.map((d: any) => {
      // Mapped radius sizes between 5 and 25
      const citations = d.totalCitations || 0;
      let r = 5;
      if (citations > 0) {
        r = Math.min(25, Math.max(5, Math.sqrt(citations) / 1.5));
      }
      return {
        x: d.paperCount,
        y: d.hIndex,
        r: r,
        deptName: d.department,
        cits: citations
      };
    });

    this.bubbleChart = new Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: [{
          data: bubbleData,
          backgroundColor: 'rgba(6, 182, 212, 0.6)', // Cyan translucent
          borderColor: '#06b6d4',
          hoverBackgroundColor: 'rgba(79, 70, 229, 0.8)',
          hoverBorderColor: '#4f46e5'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            padding: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleFont: { family: "'Outfit', sans-serif", weight: 'bold' },
            bodyFont: { family: "'Inter', sans-serif" },
            callbacks: {
              title: (items) => {
                const item = items[0];
                const rawData = item.raw as any;
                return rawData.deptName;
              },
              label: (item) => {
                const rawData = item.raw as any;
                return [
                  `Publications: ${rawData.x}`,
                  `H-Index: ${rawData.y}`,
                  `Citations: ${rawData.cits}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            title: { display: true, text: 'Publications Count', font: { family: "'Outfit', sans-serif", weight: 600 } },
            ticks: { font: { family: "'Inter', sans-serif" } },
            grid: { color: '#f8fafc' }
          },
          y: {
            title: { display: true, text: 'H-Index Value', font: { family: "'Outfit', sans-serif", weight: 600 } },
            ticks: { font: { family: "'Inter', sans-serif" } },
            grid: { color: '#f8fafc' },
            beginAtZero: true
          }
        }
      }
    });
  }

  initDistChart(): void {
    if (!this.distChartCanvas || !this.data || !this.data.citationDistribution) return;

    const ctx = this.distChartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const dist = this.data.citationDistribution;
    const labels = dist.map((d: any) => d.bracket);
    const counts = dist.map((d: any) => d.count);

    const colors = [
      'rgba(148, 163, 184, 0.8)', // Slate (0 cits)
      'rgba(244, 63, 94, 0.8)',   // Rose (1-5 cits)
      'rgba(245, 158, 11, 0.8)',  // Amber (6-10 cits)
      'rgba(16, 185, 129, 0.8)',  // Emerald (11-20 cits)
      'rgba(59, 130, 246, 0.8)',  // Blue (21-50 cits)
      'rgba(99, 102, 241, 0.8)'   // Indigo (50+ cits)
    ];

    const borderColors = ['#94a3b8', '#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#6366f1'];

    this.distChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: counts,
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
              font: { family: "'Outfit', sans-serif", size: 11, weight: 500 },
              color: '#475569'
            }
          },
          tooltip: {
            padding: 12,
            backgroundColor: 'rgba(15, 23, 42, 0.9)'
          }
        },
        cutout: '60%'
      }
    });
  }
}
