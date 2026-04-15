import { Component, OnInit, AfterViewInit, ViewChild, ElementRef, ChangeDetectionStrategy, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { PaperService } from '../../services/paper.service';
import { AuthService } from '../../services/auth.service';
import { ConsolidatedPaper } from '../../models/paper.model';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { AuthorNamePipe } from '../../pipes/author-name.pipe';

// @ts-ignore
import ForceGraph3D from '3d-force-graph';

Chart.register(...registerables);

export interface DepartmentStats {
    department: string;
    uniqueAuthors: number;
    paperCount: number;
    totalCitations?: number; // Aggregated total citations for unique papers
    quartiles?: {
        Q1: number;
        Q2: number;
        Q3: number;
        Q4: number;
        NA: number;
    };
    percentage?: number; // Pre-calculated for performance
    colorClass?: string; // Pre-calculated for performance
    authors?: { name: string, titles: string[] }[];
}

interface AnalyticsData {
    totalPapers: number;
    totalAuthors: number;
    totalCitations: number;
    totalDepartments?: number;
    avgCitations: number;
    universityHIndex: number;
    departments: DepartmentStats[];
    yearsData: { year: number, count: number }[];
    topAuthors: { name: string, count: number, hIndex?: number, totalCitations?: number }[];
    recentPapers: { title: string, year: number, type: string, citedBy: number, link?: string, authorCount: number, authorNames?: string[] }[];
    allAuthors: { name: string, count: number, hIndex?: number, totalCitations?: number }[];
    paperTypeData: { type: string, count: number }[];
    topSources: { source: string, count: number }[];
    deptCitationsData: { department: string, citations: number }[];
    yearWiseCitations?: { period: string, citations: number }[];
    collaborationNetwork?: {
        nodes: { id: string, label: string }[];
        links: { source: string, target: string, weight: number }[];
    };
    geoCollaboration?: { country: string, count: number }[];
    wordCloudData?: { text: string, value: number }[];
    topicEvolution?: { period: string, topics: { keyword: string, count: number }[] }[]; // CHANGED from year to period
    keywordNetwork?: {
        nodes: { id: string, name: string, val: number }[];
        links: { source: string, target: string, weight: number }[];
    };
    quartileDistribution?: { quartile: string, count: number }[];
    dateTrendData?: { label: string, count: number }[]; // NEW
}

export interface PersonalStats {
    name: string;
    department: string;
    totalPapers: number;
    totalCitations: number;
    hIndex: number;
    yearlyStats: Record<string, number>;
    quartiles: { Q1: number; Q2: number; Q3: number; Q4: number; NA: number };
    collaborationNetwork: {
        nodes: { id: string; department: string; isTarget?: boolean; weight: number }[];
        links: { source: string; target: string; value: number }[];
    };
    papers: any[];
}

import { NavbarComponent } from '../navbar/navbar.component';

@Component({
    selector: 'app-dashboard',
    standalone: true,
    imports: [CommonModule, RouterLink, NavbarComponent, AuthorNamePipe, FormsModule],
    templateUrl: './dashboard.component.html',
    styleUrl: './dashboard.component.css',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, AfterViewInit {
    @ViewChild('pieChartCanvas') pieChartCanvas!: ElementRef<HTMLCanvasElement>;
    @ViewChild('barChartCanvas') barChartCanvas!: ElementRef<HTMLCanvasElement>;
    @ViewChild('lineChartCanvas') lineChartCanvas!: ElementRef<HTMLCanvasElement>;

    analyticsData: AnalyticsData | null = null;
    isLoading = false;
    errorMessage = '';
    today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    pieChart: Chart | null = null;
    barChart: Chart | null = null;
    lineChart: Chart | null = null;
    paperTypeChart: Chart | null = null;
    sourceChart: Chart | null = null;
    deptCitationsChart: Chart | null = null;
    dateTrendChart: Chart | null = null; // REPLACED impactChart
    topicTrendsChart: Chart | null = null; // NEW to allow re-destruction
    quartileChart: Chart | null = null;
    deptQuartileChart: Chart | null = null;

    @ViewChild('paperTypeChartCanvas') paperTypeChartCanvas!: ElementRef<HTMLCanvasElement>;
    @ViewChild('sourceChartCanvas') sourceChartCanvas!: ElementRef<HTMLCanvasElement>;
    @ViewChild('deptCitationsChartCanvas') deptCitationsChartCanvas!: ElementRef<HTMLCanvasElement>;
    @ViewChild('dateTrendCanvas') dateTrendCanvas!: ElementRef<HTMLCanvasElement>; // REPLACED impactChartCanvas
    @ViewChild('geoMapContainer') geoMapContainer!: ElementRef<HTMLDivElement>;
    @ViewChild('collaborationContainer') collaborationContainer!: ElementRef<HTMLDivElement>;
    @ViewChild('wordCloudContainer') wordCloudContainer!: ElementRef<HTMLDivElement>;
    @ViewChild('topicTrendsChart') topicTrendsContainer!: ElementRef<HTMLCanvasElement>;
    @ViewChild('quartileChartCanvas') quartileChartCanvas!: ElementRef<HTMLCanvasElement>;
    @ViewChild('deptQuartileChartCanvas') deptQuartileChartCanvas!: ElementRef<HTMLCanvasElement>;

    // Modal State
    selectedDepartment: DepartmentStats | null = null;
    modalAuthors: any[] = [];
    isModalLoading: boolean = false;

    // Master Department Filter
    selectedDept: string = '';
    deptSearch: string = '';
    departmentList: string[] = [];
    showDeptDropdown = false;

    // Date Range Filter
    startDate: string = '';
    endDate: string = '';
    showDatePopover = false;
    dateFilterMode: 'year' | 'month' | 'range' = 'year';

    // Selection helpers
    availableYears: number[] = [];
    selectedFilterYear: number = new Date().getFullYear();
    months = [
        { name: 'January', value: 1 }, { name: 'February', value: 2 }, { name: 'March', value: 3 },
        { name: 'April', value: 4 }, { name: 'May', value: 5 }, { name: 'June', value: 6 },
        { name: 'July', value: 7 }, { name: 'August', value: 8 }, { name: 'September', value: 9 },
        { name: 'October', value: 10 }, { name: 'November', value: 11 }, { name: 'December', value: 12 }
    ];

    // --- Battle Mode Selection ---
    battleDept1: string = '';
    battleDept2: string = '';
    battleChart: Chart | null = null;
    battleMetricsData: { label: string, value1: number | string, value2: number | string, percent1: number, percent2: number }[] = [];
    allDepartmentsStats: DepartmentStats[] = []; // Full list for Battle Mode
    @ViewChild('battleChartCanvas') battleChartCanvas!: ElementRef<HTMLCanvasElement>;

    // --- Paper Type Filter for Top Contributors ---
    selectedPaperType: string = '';

    get availablePaperTypes(): string[] {
        if (!this.analyticsData?.paperTypeData) return [];
        return this.analyticsData.paperTypeData.map((pt: any) => pt.type);
    }

    get topContributorsFiltered(): any[] {
        if (!this.analyticsData?.allAuthors) return [];
        const authors = this.analyticsData.allAuthors;

        if (!this.selectedPaperType) {
            // No filter — return top 5 by total count (same as topAuthors)
            return (this.analyticsData.topAuthors || []).slice(0, 5);
        }

        // Sort by the selected paper type's count
        const type = this.selectedPaperType;
        return [...authors]
            .filter((a: any) => a.byType && a.byType[type] > 0)
            .sort((a: any, b: any) => (b.byType?.[type] || 0) - (a.byType?.[type] || 0))
            .slice(0, 5);
    }

    onPaperTypeFilterChange(): void {
        this.cdr.markForCheck();
    }

    // --- Topic View State ---
    activeTopicView: 'cloud' | 'nexus' = 'cloud';
    nexusGraph: any = null;
    @ViewChild('nexusContainer') nexusContainer!: ElementRef<HTMLDivElement>;

    currentUser: any = null;
    isPersonalDash: boolean = false;
    personalData: PersonalStats | null = null;

    // --- Filtered Authors Popover ---
    showAuthorFiltersPopover = false;
    authorMinPapers: number | string | null = null;
    authorMaxPapers: number | string | null = null;

    tempAuthorMinPapers: number | string | null = null;
    tempAuthorMaxPapers: number | string | null = null;

    toggleAuthorFiltersPopover(): void {
        this.showAuthorFiltersPopover = !this.showAuthorFiltersPopover;
        if (this.showAuthorFiltersPopover) {
            this.tempAuthorMinPapers = this.authorMinPapers;
            this.tempAuthorMaxPapers = this.authorMaxPapers;
        }
    }

    applyAuthorFilters(): void {
        this.authorMinPapers = this.tempAuthorMinPapers;
        this.authorMaxPapers = this.tempAuthorMaxPapers;
        this.showAuthorFiltersPopover = false;
        this.cdr.markForCheck();
    }

    clearAuthorFilters(): void {
        this.authorMinPapers = null;
        this.authorMaxPapers = null;
        this.tempAuthorMinPapers = null;
        this.tempAuthorMaxPapers = null;
        this.showAuthorFiltersPopover = false;
        this.cdr.markForCheck();
    }

    get filteredAuthors(): any[] {
        if (!this.analyticsData || !this.analyticsData.allAuthors) return [];

        return this.analyticsData.allAuthors.filter((author: any) => {
            const min = (this.authorMinPapers !== null && this.authorMinPapers !== '') ? Number(this.authorMinPapers) : null;
            const max = (this.authorMaxPapers !== null && this.authorMaxPapers !== '') ? Number(this.authorMaxPapers) : null;

            if (min !== null && author.count < min) return false;
            if (max !== null && author.count > max) return false;

            return true;
        });
    }

    // ── Scholar / Scopus data-source toggle ──
    dataSource: 'scopus' | 'scholar' = 'scopus';
    scholarArticles: any[] = [];
    isLoadingScholarArticles = false;
    scholarCacheData: any = null; // cached from profile /scholar/me

    get activeKpiPapers(): number {
        if (this.dataSource === 'scholar') return this.scholarCacheData?.totalPapers ?? 0;
        return this.personalData?.totalPapers ?? 0;
    }
    get activeKpiCitations(): number {
        if (this.dataSource === 'scholar') return this.scholarCacheData?.citations ?? 0;
        return this.personalData?.totalCitations ?? 0;
    }
    get activeKpiHIndex(): number {
        if (this.dataSource === 'scholar') return this.scholarCacheData?.hIndex ?? 0;
        return this.personalData?.hIndex ?? 0;
    }
    get activePapers(): any[] {
        if (this.dataSource === 'scholar') return this.scholarArticles;
        return this.personalData?.papers ?? [];
    }

    get filteredDeptOptions(): string[] {
        if (!this.deptSearch.trim()) return this.departmentList;
        const q = this.deptSearch.toLowerCase();
        return this.departmentList.filter(d => d.toLowerCase().includes(q));
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (!target.closest('.filter-search-wrap')) {
            this.showDeptDropdown = false;
        }
        if (!target.closest('.filter-date-wrap')) {
            this.showDatePopover = false;
        }
        this.cdr.markForCheck();
    }

    // Author Detail Popup State
    selectedDetailAuthor: any | null = null;

    showAuthors(dept: DepartmentStats): void {
        this.selectedDepartment = dept;
        this.isModalLoading = true;
        this.modalAuthors = [];
        document.body.style.overflow = 'hidden';
        this.cdr.markForCheck();

        if (dept.department) {
            this.paperService.getShardaAuthors(dept.department).subscribe({
                next: (response) => {
                    this.isModalLoading = false;
                    console.log('Author API Response:', response);
                    if (response.success && response.data) {
                        const uniqueAuthorsMap = new Map();

                        response.data.forEach(author => {
                            if (author.authorName && !uniqueAuthorsMap.has(author.authorName)) {
                                uniqueAuthorsMap.set(author.authorName, {
                                    name: author.authorName,
                                    titles: author.allPaperTitles || []
                                });
                            }
                        });

                        this.modalAuthors = Array.from(uniqueAuthorsMap.values());
                        console.log('Mapped Modal Authors:', this.modalAuthors);
                        this.cdr.markForCheck();
                    }
                },
                error: (error) => {
                    this.isModalLoading = false;
                    console.error('Failed to load authors', error);
                    this.cdr.markForCheck();
                }
            });
        }
    }

    showGlobalAuthors(): void {
        const globalDept: DepartmentStats = {
            department: 'All Sharda University Departments',
            uniqueAuthors: this.analyticsData?.totalAuthors || 0,
            paperCount: this.analyticsData?.totalPapers || 0,
            colorClass: 'color-1'
        };

        this.selectedDepartment = globalDept;
        this.isModalLoading = true;
        this.modalAuthors = [];
        document.body.style.overflow = 'hidden';
        this.cdr.markForCheck();

        this.paperService.getShardaAuthors().subscribe({
            next: (response) => {
                this.isModalLoading = false;
                if (response.success && response.data) {
                    const uniqueAuthorsMap = new Map();
                    response.data.forEach(author => {
                        if (author.authorName && !uniqueAuthorsMap.has(author.authorName)) {
                            uniqueAuthorsMap.set(author.authorName, {
                                name: author.authorName,
                                titles: author.allPaperTitles || []
                            });
                        }
                    });
                    this.modalAuthors = Array.from(uniqueAuthorsMap.values());
                    this.cdr.markForCheck();
                }
            },
            error: (error) => {
                this.isModalLoading = false;
                console.error('Failed to load global authors', error);
                this.cdr.markForCheck();
            }
        });
    }

    openAuthorPopup(author: any): void {
        this.selectedDetailAuthor = author;
    }

    closeAuthorPopup(): void {
        this.selectedDetailAuthor = null;
    }

    closeModal(): void {
        this.selectedDepartment = null;
        this.selectedDetailAuthor = null;
        this.modalAuthors = [];
        this.isModalLoading = false;
        document.body.style.overflow = 'auto';
        this.cdr.markForCheck();
    }

    logout(): void {
        this.authService.logout();
    }

    // --- Papers Modal State ---
    showPapersModal: boolean = false;
    papersModalSearch: string = '';

    showAllPapers(): void {
        if (!this.analyticsData || this.analyticsData.totalPapers === 0) return;
        this.showPapersModal = true;
        this.papersModalSearch = '';
        document.body.style.overflow = 'hidden';
        this.cdr.markForCheck();
    }

    closePapersModal(): void {
        this.showPapersModal = false;
        this.papersModalSearch = '';
        document.body.style.overflow = 'auto';
        this.cdr.markForCheck();
    }

    get filteredPapersModal(): any[] {
        if (!this.analyticsData?.recentPapers) return [];
        if (!this.papersModalSearch.trim()) return this.analyticsData.recentPapers;
        const q = this.papersModalSearch.toLowerCase().trim();
        return this.analyticsData.recentPapers.filter((p: any) =>
            (p.title || '').toLowerCase().includes(q) ||
            (p.authorNames || []).some((a: string) => a.toLowerCase().includes(q)) ||
            (p.type || '').toLowerCase().includes(q)
        );
    }

    // --- Collapsible Paper Groups ---
    activePaperType: string = '';
    papersModalView: 'types' | 'quartiles' = 'types';
    activeQuartile: string = '';

    get activePapersList(): any[] {
        if (!this.activePaperType) return [];
        return this.filteredPapersModal.filter((p: any) => (p.type || 'Unknown') === this.activePaperType);
    }

    get activeQuartilePapers(): any[] {
        if (!this.activeQuartile) return [];
        return this.filteredPapersModal.filter((p: any) => (p.quartile || 'NA') === this.activeQuartile);
    }

    togglePaperType(type: string): void {
        this.activePaperType = this.activePaperType === type ? '' : type;
        this.cdr.markForCheck();
    }

    toggleQuartile(q: string): void {
        this.activeQuartile = this.activeQuartile === q ? '' : q;
        this.cdr.markForCheck();
    }

    switchPapersView(view: 'types' | 'quartiles'): void {
        this.papersModalView = view;
        this.activePaperType = '';
        this.activeQuartile = '';
        this.cdr.markForCheck();
    }

    navigateToFullPaperList(): void {
        this.closePapersModal();
        const queryParams: any = {};
        if (this.selectedDept && this.selectedDept !== 'All') queryParams.department = this.selectedDept;
        if (this.startDate) queryParams.startDate = this.startDate;
        if (this.endDate) queryParams.endDate = this.endDate;
        this.router.navigate(['/paper-list'], { queryParams });
    }

    // trackBy functions for performance
    trackByAuthorName(index: number, author: any): string {
        return author.name || index.toString();
    }

    trackByPaperTitle(index: number, paper: any): string {
        return paper.title || index.toString();
    }

    trackByDeptName(index: number, dept: DepartmentStats): string {
        return dept.department || index.toString();
    }

    trackByLinkId(index: number, link: any): string {
        return `${link.source}-${link.target}`;
    }

    getQuartileClass(quartile: string | undefined): string {
        if (!quartile) return 'quartile-na';
        const q = quartile.toUpperCase();
        if (q === 'Q1') return 'quartile-q1';
        if (q === 'Q2') return 'quartile-q2';
        if (q === 'Q3') return 'quartile-q3';
        if (q === 'Q4') return 'quartile-q4';
        return 'quartile-na';
    }

    downloadQuartileCSV(): void {
        let url = `/api/papers/download/quartiles?`;
        const params: string[] = [];
        if (this.selectedDept && this.selectedDept !== 'All') params.push(`department=${encodeURIComponent(this.selectedDept)}`);
        if (this.startDate) params.push(`startDate=${encodeURIComponent(this.startDate)}`);
        if (this.endDate) params.push(`endDate=${encodeURIComponent(this.endDate)}`);
        
        url += params.join('&');
        // Navigate or open to trigger browser download
        window.location.href = url;
    }


    constructor(

        private paperService: PaperService,
        private location: Location,
        private cdr: ChangeDetectorRef,
        private authService: AuthService,
        private router: Router
    ) { }

    ngOnInit(): void {
        this.loadDepartmentList();

        // Auto-apply department filter for professors and save user info
        this.currentUser = this.authService.getCurrentUser();
        if (this.currentUser?.role === 'Professor' && this.currentUser?.designation === 'Other') {
            this.isPersonalDash = true;
        }

        if (this.currentUser?.role === 'Professor' && this.currentUser?.department) {
            this.selectedDept = this.currentUser.department;
            this.deptSearch = this.currentUser.department;
        }

        if (this.isPersonalDash && this.currentUser?.name) {
            this.loadPersonalStats(this.currentUser.name);
            this.loadScholarCache(); // preload Scholar KPI data for toggle
        } else {
            this.loadAnalytics();
        }
    }

    ngAfterViewInit(): void {
        // Chart will be initialized after data is loaded
    }

    loadDepartmentList(): void {
        this.paperService.getDepartments().subscribe({
            next: (res: any) => {
                const raw: string[] = res.success ? res.data : (Array.isArray(res) ? res : []);
                this.departmentList = raw
                    .filter(d => d && d.toLowerCase() !== 'na')
                    .sort();
                this.cdr.markForCheck();
            },
            error: () => { }
        });
    }

    filterByDept(dept: string): void {
        this.selectedDept = dept;
        this.deptSearch = dept;
        this.showDeptDropdown = false;
        this.loadAnalytics();
    }

    clearDeptFilter(): void {
        this.selectedDept = '';
        this.deptSearch = '';
        this.loadAnalytics();
    }

    onDateChange(): void {
        this.loadAnalytics();
    }

    toggleDatePopover(): void {
        this.showDatePopover = !this.showDatePopover;
        if (this.showDatePopover && this.availableYears.length === 0) {
            this.generateAvailableYears();
        }
    }

    private generateAvailableYears(): void {
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y >= currentYear - 10; y--) {
            this.availableYears.push(y);
        }
    }

    selectYear(year: number): void {
        this.startDate = `${year}-01-01`;
        this.endDate = `${year}-12-31`;
        this.selectedFilterYear = year;
        this.showDatePopover = false;
        this.loadAnalytics();
    }

    selectMonth(monthValue: number): void {
        const year = this.selectedFilterYear;
        const lastDay = new Date(year, monthValue, 0).getDate();
        this.startDate = `${year}-${monthValue.toString().padStart(2, '0')}-01`;
        this.endDate = `${year}-${monthValue.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
        this.showDatePopover = false;
        this.loadAnalytics();
    }

    getDateDisplayLabel(): string {
        if (!this.startDate && !this.endDate) return 'All Time';
        if (this.startDate === `${this.selectedFilterYear}-01-01` && this.endDate === `${this.selectedFilterYear}-12-31`) {
            return `Year: ${this.selectedFilterYear}`;
        }

        // Check if it matches a full month
        if (this.startDate && this.endDate) {
            const startParts = this.startDate.split('-');
            const endParts = this.endDate.split('-');
            if (startParts[0] === endParts[0] && startParts[1] === endParts[1] && startParts[2] === '01') {
                const monthName = this.months.find(m => m.value === parseInt(startParts[1]))?.name;
                return `${monthName} ${startParts[0]}`;
            }
        }

        return 'Custom Range';
    }

    clearDateFilter(): void {
        this.startDate = '';
        this.endDate = '';
        this.showDatePopover = false;
        this.loadAnalytics();
    }

    loadAnalytics(): void {
        this.isLoading = true;
        this.errorMessage = '';

        this.paperService.getAnalytics(
            this.selectedDept || undefined,
            this.startDate || undefined,
            this.endDate || undefined
        ).subscribe({
            next: (response) => {
                this.isLoading = false;
                if (response.success && response.data) {
                    const data = response.data;
                    this.analyticsData = data;

                    // ALWAYS synchronize global stats for Battle Mode with the active dates
                    if (!this.selectedDept && data.departments && data.departments.length > 1) {
                        // If no department filter, the main response has everything we need
                        this.allDepartmentsStats = [...data.departments];
                    } else {
                        // If a department filter is active (or response is partial), 
                        // fetch background global stats using the SAME date filters
                        this.loadGlobalStatsForBattle();
                    }

                    // Pre-calculate department stats for performance
                    if (data.departments && data.totalPapers > 0) {
                        data.departments.forEach((dept: DepartmentStats, index: number) => {
                            dept.percentage = Math.round((dept.paperCount / (data.totalPapers || 1)) * 100);
                            dept.colorClass = this.calculateColorClass(index);
                        });
                    }

                    this.initializeCharts();
                    this.cdr.markForCheck();
                } else {
                    this.errorMessage = 'Failed to load analytics data';
                    this.cdr.markForCheck();
                }
            },
            error: (error) => {
                this.isLoading = false;
                this.errorMessage = error.error?.message || 'Failed to load analytics';
                this.cdr.markForCheck();
            }
        });
    }

    loadPersonalStats(authorName: string): void {
        this.isLoading = true;
        this.errorMessage = '';

        this.paperService.getAuthorStats(authorName).subscribe({
            next: (response) => {
                this.isLoading = false;
                if (response) {
                    this.personalData = response;
                    this.initializePersonalCharts();
                    this.cdr.markForCheck();
                } else {
                    this.setEmptyPersonalData(authorName);
                }
            },
            error: (error) => {
                this.isLoading = false;
                // Add empty state mapping if no papers are found to prevent dashboard break
                this.setEmptyPersonalData(authorName);
                this.errorMessage = error.error?.error || 'Failed to load personal data';
                this.cdr.markForCheck();
            }
        });
    }

    private setEmptyPersonalData(authorName: string): void {
        this.personalData = {
            name: authorName,
            department: this.currentUser?.department || 'NA',
            totalPapers: 0,
            totalCitations: 0,
            hIndex: 0,
            yearlyStats: { [new Date().getFullYear().toString()]: 0 },
            quartiles: { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NA: 0 },
            collaborationNetwork: { nodes: [], links: [] },
            papers: []
        };
        this.initializePersonalCharts();
        this.cdr.markForCheck();
    }

    /** Load Scholar KPI cache (totalPapers, citations, hIndex) for the toggle header */
    loadScholarCache(): void {
        this.paperService.getScholarData().subscribe({
            next: (res) => {
                if (res.success && res.data) {
                    this.scholarCacheData = res.data;
                    this.cdr.markForCheck();
                }
            },
            error: () => { } // silently ignore if no profile linked
        });
    }

    /** Toggle between Scopus DB and Google Scholar data source */
    toggleDataSource(): void {
        this.dataSource = this.dataSource === 'scopus' ? 'scholar' : 'scopus';

        // Lazy-load Scholar articles on first switch to Scholar mode
        if (this.dataSource === 'scholar' && this.scholarArticles.length === 0 && !this.isLoadingScholarArticles) {
            this.isLoadingScholarArticles = true;
            this.cdr.markForCheck();
            this.paperService.getScholarArticles().subscribe({
                next: (res) => {
                    this.scholarArticles = res.data || [];
                    this.isLoadingScholarArticles = false;
                    this.cdr.markForCheck();
                },
                error: () => {
                    this.isLoadingScholarArticles = false;
                    this.cdr.markForCheck();
                }
            });
        } else {
            this.cdr.markForCheck();
        }
    }

    personalYearChart: Chart | null = null;
    personalQuartileChart: Chart | null = null;
    @ViewChild('personalYearChartCanvas') personalYearChartCanvas!: ElementRef<HTMLCanvasElement>;
    @ViewChild('personalQuartileChartCanvas') personalQuartileChartCanvas!: ElementRef<HTMLCanvasElement>;

    private initializePersonalCharts(): void {
        setTimeout(() => {
            this.initPersonalYearlyChart();
            this.initPersonalQuartileChart();
        }, 100);
    }

    private initPersonalYearlyChart(): void {
        const stats = this.personalData?.yearlyStats;
        if (!stats || !this.personalYearChartCanvas) return;

        const years = Object.keys(stats).sort();
        const counts = years.map(y => stats[y]);

        if (this.personalYearChart) {
            this.personalYearChart.destroy();
        }

        const ctx = this.personalYearChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        // Create solid color for Dribbble Project Analytics
        const barColor = '#10b981';

        this.personalYearChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: years,
                datasets: [{
                    label: 'Publications',
                    data: counts,
                    backgroundColor: barColor,
                    borderRadius: 20, // highly rounded bars like dribbble
                    barPercentage: 0.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#111827',
                        padding: 12,
                        titleFont: { family: 'Inter', size: 14 },
                        bodyFont: { family: 'Inter', size: 13 },
                        displayColors: false
                    }
                },
                scales: {
                    y: {
                        display: false, // hide completely like Dribbble
                        beginAtZero: true
                    },
                    x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: { font: { family: 'Inter', size: 11 }, color: '#9ca3af' }
                    }
                }
            }
        });
    }

    private initPersonalQuartileChart(): void {
        const qData = this.personalData?.quartiles;
        if (!qData || !this.personalQuartileChartCanvas) return;

        const labels = ['Q1', 'Q2', 'Q3', 'Q4', 'Unclassified'];
        const data = [qData.Q1, qData.Q2, qData.Q3, qData.Q4, qData.NA];
        const total = data.reduce((s, v) => s + v, 0);

        const backgroundColors = [
            '#10b981', // Q1 – emerald
            '#3b82f6', // Q2 – royal blue
            '#f59e0b', // Q3 – amber
            '#ef4444', // Q4 – rose/red
            '#e2e8f0', // Unclassified – gray
        ];

        // Center-label plugin — shows total papers in middle of ring
        const centerLabelPlugin = {
            id: 'centerLabel',
            afterDraw(chart: any) {
                const { width, height, ctx } = chart;
                ctx.restore();
                const fontSize = (height / 100).toFixed(2);
                ctx.font = `bold ${parseFloat(fontSize) * 10}px Inter, sans-serif`;
                ctx.fillStyle = '#1e293b';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${total}`, width / 2, height / 2 - 10);
                ctx.font = `${parseFloat(fontSize) * 6}px Inter, sans-serif`;
                ctx.fillStyle = '#64748b';
                ctx.fillText('papers', width / 2, height / 2 + 14);
                ctx.save();
            }
        };

        if (this.personalQuartileChart) {
            this.personalQuartileChart.destroy();
        }

        const ctx = this.personalQuartileChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        this.personalQuartileChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: backgroundColors,
                    borderWidth: 3,
                    borderColor: '#ffffff',
                    hoverBorderWidth: 4,
                    hoverOffset: 8
                }]
            },
            plugins: [centerLabelPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: {
                        display: true,
                        position: 'bottom',
                        labels: {
                            padding: 12,
                            font: { family: 'Inter', size: 11, weight: 600 },
                            color: '#475569',
                            usePointStyle: true,
                            pointStyle: 'circle',
                            generateLabels: (chart: any) => {
                                return chart.data.labels.map((label: string, i: number) => ({
                                    text: `${label}  ${data[i]}`,
                                    fillStyle: backgroundColors[i],
                                    index: i,
                                    hidden: false
                                }));
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        padding: 12,
                        cornerRadius: 10,
                        titleFont: { family: 'Inter', size: 13, weight: 'bold' },
                        bodyFont: { family: 'Inter', size: 12 },
                        callbacks: {
                            label: (context: any) => {
                                const val = context.parsed;
                                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                                return `  ${val} papers (${pct}%)`;
                            }
                        }
                    }
                },
                animation: { animateRotate: true, duration: 900 }
            }
        });
    }


    private initializeCharts(): void {
        setTimeout(() => { // Keep setTimeout for DOM rendering
            this.initializePieChart();
            this.initializeBarChart();
            this.initializeLineChart();
            this.initializePaperTypeChart();
            this.initializeSourceChart();
            this.initializeDeptCitationsChart();
            this.initializeDeptQuartileChart();
            this.initializeGeoMap();
            this.initializeCollaborationHeatmap();
            this.initializeDateTrendChart(); // NEW
            this.initializeTopicTrends();
            this.initializeQuartileChart();
            this.initializeBattleMode(); // NEW
            this.initialize3DNexus(); // NEW
        }, 100);
    }

    /**
     * Initialize the bar chart with department author data
     */
    initializeBarChart(): void {
        if (!this.analyticsData || !this.barChartCanvas) {
            return;
        }

        // Destroy existing chart if it exists
        if (this.barChart) {
            this.barChart.destroy();
        }

        const ctx = this.barChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        // Take top 30 departments for the bar chart to ensure all 25 are shown
        const topDepartments = this.analyticsData.departments
            .slice(0, 30)
            .sort((a, b) => b.uniqueAuthors - a.uniqueAuthors);

        // Create a nice gradient for the bars
        const gradient = ctx.createLinearGradient(0, 0, 800, 0);
        gradient.addColorStop(0, 'rgba(79, 70, 229, 0.8)');  // Indigo 600
        gradient.addColorStop(1, 'rgba(124, 58, 237, 0.8)'); // Violet 600

        const config: ChartConfiguration = {
            type: 'bar',
            data: {
                labels: topDepartments.map(dept => dept.department || 'NA'),
                datasets: [{
                    label: 'Unique Authors',
                    data: topDepartments.map(dept => dept.uniqueAuthors),
                    backgroundColor: gradient,
                    borderColor: '#4338ca',
                    borderWidth: 1,
                    borderRadius: 6,
                    barPercentage: 0.7,
                    categoryPercentage: 0.8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y', // Horizontal bar chart
                onClick: (event, elements) => {
                    if (elements && elements.length > 0) {
                        const index = elements[0].index;
                        const dept = topDepartments[index];
                        if (dept) {
                            this.showAuthors(dept);
                        }
                    }
                },
                onHover: (event, elements) => {
                    const target = event.native?.target as HTMLElement;
                    if (target) {
                        target.style.cursor = elements.length > 0 ? 'pointer' : 'default';
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        border: {
                            display: false
                        },
                        ticks: {
                            font: { size: 11 }
                        },
                        title: {
                            display: true,
                            text: 'Number of Authors',
                            font: { weight: 'bold' }
                        }
                    },
                    y: {
                        border: {
                            display: false
                        },
                        grid: {
                            display: false
                        },
                        ticks: {
                            autoSkip: false,
                            font: {
                                size: 11,
                                weight: 500
                            },
                            padding: 10
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        padding: 12,
                        cornerRadius: 8,
                        titleFont: { size: 14, weight: 'bold' },
                        bodyFont: { size: 13 },
                        callbacks: {
                            label: (context) => ` Authors: ${context.parsed.x}`
                        }
                    }
                }
            }
        };

        this.barChart = new Chart(ctx, config);
    }

    /**
     * Initialize the line chart with year-wise paper data
     */
    initializeLineChart(): void {
        if (!this.analyticsData || !this.lineChartCanvas || !this.analyticsData.yearsData) {
            return;
        }

        // Destroy existing chart if it exists
        if (this.lineChart) {
            this.lineChart.destroy();
        }

        const ctx = this.lineChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        const yearsData = this.analyticsData.yearsData;
        const labels = yearsData.map(d => d.year);
        const data = yearsData.map(d => d.count);

        // Gradient fill
        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.5)'); // Indigo
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.05)');

        const config: ChartConfiguration = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Papers Published',
                    data: data,
                    borderColor: '#6366f1', // Indigo 500
                    backgroundColor: gradient,
                    borderWidth: 3,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#6366f1',
                    pointBorderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    fill: true,
                    tension: 0.4 // Smooth curve
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        padding: 12,
                        titleFont: {
                            size: 14,
                            weight: 'bold'
                        },
                        bodyFont: {
                            size: 13
                        },
                        callbacks: {
                            label: (context) => `Papers: ${context.parsed.y}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: false
                        },
                        ticks: {
                            font: {
                                size: 12
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)'
                        },
                        ticks: {
                            font: {
                                size: 11
                            },
                            precision: 0
                        }
                    }
                }
            }
        };

        this.lineChart = new Chart(ctx, config);
    }

    /**
     * Helper to calculate color class (replaces getColorClass for pre-calculation)
     */
    private calculateColorClass(index: number): string {
        const classes = ['blue', 'green', 'purple', 'orange', 'pink', 'teal'];
        return classes[index % classes.length];
    }

    // Legacy method kept for compatibility if needed elsewhere
    getColorClass(index: number): string {
        return this.calculateColorClass(index);
    }

    /**
     * Initialize the pie chart with department data
     */
    initializePieChart(): void {
        if (!this.analyticsData || !this.pieChartCanvas) {
            return;
        }

        // Destroy existing chart if it exists
        if (this.pieChart) {
            this.pieChart.destroy();
        }

        const ctx = this.pieChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        // Take top 10 departments for the pie chart
        const topDepartments = (this.allDepartmentsStats || this.analyticsData.departments).slice(0, 10);

        // Generate vibrant colors for the pie chart
        const backgroundColors = [
            'rgba(102, 126, 234, 0.8)',  // Blue
            'rgba(72, 187, 120, 0.8)',   // Green
            'rgba(159, 122, 234, 0.8)',  // Purple
            'rgba(237, 137, 54, 0.8)',   // Orange
            'rgba(237, 100, 166, 0.8)',  // Pink
            'rgba(56, 178, 172, 0.8)',   // Teal
            'rgba(66, 153, 225, 0.8)',   // Light Blue
            'rgba(246, 173, 85, 0.8)',   // Yellow
            'rgba(236, 72, 153, 0.8)',   // Rose
            'rgba(52, 211, 153, 0.8)',   // Emerald
        ];

        const borderColors = [
            'rgba(102, 126, 234, 1)',
            'rgba(72, 187, 120, 1)',
            'rgba(159, 122, 234, 1)',
            'rgba(237, 137, 54, 1)',
            'rgba(237, 100, 166, 1)',
            'rgba(56, 178, 172, 1)',
            'rgba(66, 153, 225, 1)',
            'rgba(246, 173, 85, 1)',
            'rgba(236, 72, 153, 1)',
            'rgba(52, 211, 153, 1)',
        ];

        const config: ChartConfiguration = {
            type: 'pie',
            data: {
                labels: topDepartments.map(dept => dept.department || 'NA'),
                datasets: [{
                    label: 'Papers',
                    data: topDepartments.map(dept => dept.paperCount),
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: 2,
                    hoverOffset: 15
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            padding: 15,
                            font: {
                                size: 12,
                                family: "'Inter', sans-serif"
                            },
                            usePointStyle: true,
                            pointStyle: 'circle',
                            generateLabels: (chart) => {
                                const data = chart.data;
                                if (data.labels && data.datasets.length) {
                                    return data.labels.map((label, i) => {
                                        const dataset = data.datasets[0];
                                        const value = dataset.data[i] as number;
                                        const total = (dataset.data as number[]).reduce((a, b) => a + b, 0);
                                        const percentage = ((value / total) * 100).toFixed(1);
                                        const bgColors = dataset.backgroundColor as string[];
                                        return {
                                            text: `${label}: ${value} (${percentage}%)`,
                                            fillStyle: bgColors[i],
                                            hidden: false,
                                            index: i
                                        };
                                    });
                                }
                                return [];
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        padding: 12,
                        titleFont: {
                            size: 14,
                            weight: 'bold'
                        },
                        bodyFont: {
                            size: 13
                        },
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed;
                                const total = (context.dataset.data as number[]).reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return [
                                    `${label}`,
                                    `Papers: ${value}`,
                                    `Percentage: ${percentage}%`
                                ];
                            }
                        }
                    }
                },
                animation: {
                    duration: 1000
                }
            }
        };

        this.pieChart = new Chart(ctx, config);
    }
    /**
     * Initialize the Paper Type Distribution Chart (Doughnut)
     */
    initializePaperTypeChart(): void {
        if (!this.analyticsData || !this.paperTypeChartCanvas || !this.analyticsData.paperTypeData) return;
        if (this.paperTypeChart) this.paperTypeChart.destroy();

        const ctx = this.paperTypeChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        const data = this.analyticsData.paperTypeData;
        const colors = [
            '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
            '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6'
        ];

        this.paperTypeChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.map(d => d.type),
                datasets: [{
                    data: data.map(d => d.count),
                    backgroundColor: colors,
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { padding: 20, usePointStyle: true }
                    }
                },
                cutout: '70%'
            }
        });
    }

    /**
     * Initialize the Top Sources Chart (Horizontal Bar)
     */
    initializeSourceChart(): void {
        if (!this.analyticsData || !this.sourceChartCanvas || !this.analyticsData.topSources) return;
        if (this.sourceChart) this.sourceChart.destroy();

        const ctx = this.sourceChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        const data = this.analyticsData.topSources;

        // Create an elegant horizontal gradient for the bars
        const gradient = ctx.createLinearGradient(0, 0, 800, 0);
        gradient.addColorStop(0, 'rgba(168, 85, 247, 0.8)');   // Purple 500
        gradient.addColorStop(1, 'rgba(236, 72, 153, 0.8)');   // Pink 500

        const hoverGradient = ctx.createLinearGradient(0, 0, 800, 0);
        hoverGradient.addColorStop(0, 'rgba(168, 85, 247, 1)');
        hoverGradient.addColorStop(1, 'rgba(236, 72, 153, 1)');

        this.sourceChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.source.length > 30 ? d.source.substring(0, 30) + '...' : d.source),
                datasets: [{
                    label: 'Publications',
                    data: data.map(d => d.count),
                    backgroundColor: gradient,
                    hoverBackgroundColor: hoverGradient,
                    borderWidth: 0,
                    borderRadius: 6, // Sleek rounded corners
                    barThickness: 24
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        padding: 12,
                        cornerRadius: 8,
                        titleFont: { size: 14, weight: 'bold' },
                        bodyFont: { size: 13 }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(0, 0, 0, 0.04)'
                        },
                        ticks: { font: { size: 12 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 11, family: "'Inter', sans-serif" },
                            color: '#475569'
                        }
                    }
                }
            }
        });
    }

    /**
     * Initialize the Department Citations Chart (Area/Mountain Curve)
     */
    initializeDeptCitationsChart(): void {
        if (!this.analyticsData || !this.deptCitationsChartCanvas) return;
        if (this.deptCitationsChart) this.deptCitationsChart.destroy();

        const ctx = this.deptCitationsChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        // Condition 1: A specific department is selected -> Show Year-wise Citations
        if (this.selectedDept && this.analyticsData.yearWiseCitations && this.analyticsData.yearWiseCitations.length) {
            const data = this.analyticsData.yearWiseCitations;

            // Determine label formatting format
            const isDaily = data[0].period && data[0].period.length > 7;
            const labels = data.map((d: any) => {
                const p = d.period || '';
                if (isDaily) {
                    // "2025-05-15" -> "15 May"
                    const parts = p.split('-');
                    if (parts.length === 3) {
                        const monthInfo = this.months.find(m => m.value === parseInt(parts[1]));
                        return `${parts[2]} ${monthInfo?.name.substring(0, 3)}`;
                    }
                } else if (p.length === 7) {
                    // "2025-05" -> "May 2025"
                    const parts = p.split('-');
                    if (parts.length === 2) {
                        const monthInfo = this.months.find(m => m.value === parseInt(parts[1]));
                        return `${monthInfo?.name.substring(0, 3)} ${parts[0]}`;
                    }
                }
                return p; // Fallback to YYYY
            });

            const gradient = ctx.createLinearGradient(0, 0, 0, 600);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.8)');    // Emerald 500
            gradient.addColorStop(0.5, 'rgba(52, 211, 153, 0.3)');  // Emerald 400
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0.00)');

            this.deptCitationsChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Citations',
                        data: data.map(d => d.citations),
                        backgroundColor: gradient,
                        borderColor: '#10b981',
                        borderWidth: 4,
                        pointBackgroundColor: '#ffffff',
                        pointBorderColor: '#10b981',
                        pointBorderWidth: 3,
                        pointRadius: 0,
                        pointHoverRadius: 8,
                        pointHoverBackgroundColor: '#10b981',
                        pointHoverBorderColor: '#ffffff',
                        pointHoverBorderWidth: 4,
                        fill: 'start',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: {
                            type: 'category',
                            grid: { display: false }
                        },
                        y: { beginAtZero: true, grid: { color: 'rgba(0, 0, 0, 0.05)' } }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.85)',
                            padding: 12,
                            cornerRadius: 8,
                            titleFont: { size: 14, weight: 'bold' },
                            bodyFont: { size: 13 },
                            callbacks: {
                                label: (context) => ` Citations: ${(context.parsed.y || 0).toLocaleString()}`
                            }
                        }
                    }
                }
            });
            return;
        }

        // Condition 2: No specific department is selected -> Show Paper Count per Department
        if (!this.analyticsData.departments) return;
        const data = [...this.analyticsData.departments]
            .sort((a, b) => (b.paperCount || 0) - (a.paperCount || 0))
            .slice(0, 30);

        const gradient = ctx.createLinearGradient(0, 0, 0, 750);
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.9)');    // Indigo 500
        gradient.addColorStop(0.4, 'rgba(168, 85, 247, 0.6)');  // Purple 500
        gradient.addColorStop(0.8, 'rgba(236, 72, 153, 0.2)');  // Pink 500
        gradient.addColorStop(1, 'rgba(236, 72, 153, 0.00)');

        this.deptCitationsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => {
                    let name = d.department || 'NA';
                    name = name.replace('Department of ', '');
                    return name.length > 35 ? name.substring(0, 35) + '...' : name;
                }),
                datasets: [{
                    label: 'Paper Count',
                    data: data.map(d => d.paperCount || 0),
                    backgroundColor: gradient,
                    borderColor: '#8b5cf6', // Violet
                    borderWidth: 5,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#8b5cf6',
                    pointBorderWidth: 3,
                    pointRadius: 0,
                    pointHoverRadius: 10,
                    pointHoverBackgroundColor: '#8b5cf6',
                    pointHoverBorderColor: '#ffffff',
                    pointHoverBorderWidth: 4,
                    fill: 'start',
                    tension: 0.4,
                    cubicInterpolationMode: 'monotone'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                layout: {
                    padding: {
                        bottom: 20,
                        top: 10,
                        left: 10,
                        right: 10
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 11, weight: 500 },
                            maxRotation: 45,
                            minRotation: 45,
                            padding: 10,
                            color: '#64748b'
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: 'rgba(226, 232, 240, 0.6)',
                            drawTicks: false
                        },
                        border: { display: false },
                        ticks: {
                            font: { size: 12, weight: 500 },
                            color: '#64748b',
                            padding: 15,
                            callback: function (value) { return value.toLocaleString(); }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        padding: 16,
                        cornerRadius: 12,
                        titleFont: { size: 15, weight: 800, family: "'Outfit', sans-serif" },
                        bodyFont: { size: 14, weight: 500 },
                        displayColors: false,
                        boxPadding: 6,
                        callbacks: {
                            title: (context) => {
                                const idx = context[0].dataIndex;
                                return data[idx].department || 'NA';
                            },
                            label: (context) => `📄 Papers: ${(context.parsed.y || 0).toLocaleString()}`
                        }
                    }
                }
            }
        });
    }

    /**
     * Initialize the Department Quartile 100% Stacked Bar Chart
     */
    initializeDeptQuartileChart(): void {
        if (!this.analyticsData || !this.deptQuartileChartCanvas || !this.analyticsData.departments) return;
        if (this.deptQuartileChart) this.deptQuartileChart.destroy();

        const ctx = this.deptQuartileChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        // Take top 25 departments by paper count to keep things legible (increased from 15)
        let data = [...this.analyticsData.departments]
            .sort((a, b) => b.paperCount - a.paperCount)
            .slice(0, 25);

        // Calculate percentages and map them to sortable objects
        let sortedData = data.map(d => {
            const qCount = d.quartiles || { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NA: 0 };
            const total = qCount.Q1 + qCount.Q2 + qCount.Q3 + qCount.Q4 + qCount.NA;

            let name = d.department || 'NA';
            name = name.replace('Department of ', '');
            let label = name.length > 20 ? name.substring(0, 20) + '...' : name;

            return {
                original: d,
                label: label,
                Q1: total > 0 ? (qCount.Q1 / total) * 100 : 0,
                Q2: total > 0 ? (qCount.Q2 / total) * 100 : 0,
                Q3: total > 0 ? (qCount.Q3 / total) * 100 : 0,
                Q4: total > 0 ? (qCount.Q4 / total) * 100 : 0,
                NA: total > 0 ? (qCount.NA / total) * 100 : 0,
                raw: qCount,
                total
            };
        });

        // Rank based on higher Q1, then Q2, Q3, Q4
        sortedData.sort((a, b) => {
            if (b.Q1 !== a.Q1) return b.Q1 - a.Q1;
            if (b.Q2 !== a.Q2) return b.Q2 - a.Q2;
            if (b.Q3 !== a.Q3) return b.Q3 - a.Q3;
            return b.Q4 - a.Q4;
        });

        // Re-extract arrays for Chart.js
        const percentages = sortedData;
        const labels = sortedData.map(d => d.label);
        data = sortedData.map(d => d.original); // Update 'data' so Tooltip index reference continues to work

        // Calculate total counts for each quartile across ALL departments for the legend
        // This ensures the legend reflects the truly global totals as requested
        const allDepts = this.analyticsData.departments;
        const totalQ1 = allDepts.reduce((s, p) => s + (p.quartiles?.Q1 || 0), 0);
        const totalQ2 = allDepts.reduce((s, p) => s + (p.quartiles?.Q2 || 0), 0);
        const totalQ3 = allDepts.reduce((s, p) => s + (p.quartiles?.Q3 || 0), 0);
        const totalQ4 = allDepts.reduce((s, p) => s + (p.quartiles?.Q4 || 0), 0);
        const totalNA = allDepts.reduce((s, p) => s + (p.quartiles?.NA || 0), 0);

        this.deptQuartileChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: `Q1 Top Tier (${totalQ1})`,
                        data: percentages.map(p => p.Q1),
                        backgroundColor: '#10b981', // Emerald 500
                        borderWidth: 0,
                    },
                    {
                        label: `Q2 High Tier (${totalQ2})`,
                        data: percentages.map(p => p.Q2),
                        backgroundColor: '#3b82f6', // Blue 500
                        borderWidth: 0,
                    },
                    {
                        label: `Q3 Mid Tier (${totalQ3})`,
                        data: percentages.map(p => p.Q3),
                        backgroundColor: '#f59e0b', // Amber 500
                        borderWidth: 0,
                    },
                    {
                        label: `Q4 Entry Tier (${totalQ4})`,
                        data: percentages.map(p => p.Q4),
                        backgroundColor: '#ef4444', // Red 500
                        borderWidth: 0,
                    },
                    {
                        label: `Unassigned/NA (${totalNA})`,
                        data: percentages.map(p => p.NA),
                        backgroundColor: '#9ca3af', // Gray 400
                        borderWidth: 0,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y', // Horizontal stacked looks better for departments
                scales: {
                    x: {
                        stacked: true,
                        max: 100,
                        ticks: {
                            callback: function (value) { return value + '%' }
                        },
                        grid: { display: false }
                    },
                    y: {
                        stacked: true,
                        grid: { display: false },
                        ticks: { font: { size: 11, weight: 'bold' } }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { usePointStyle: true, padding: 20, font: { weight: 'bold' } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#1f2937',
                        bodyColor: '#4b5563',
                        borderColor: '#e5e7eb',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            title: (context) => {
                                const idx = context[0].dataIndex;
                                return data[idx].department || 'NA';
                            },
                            label: (context) => {
                                const datasetLabel = context.dataset.label;
                                const originalIndex = context.dataIndex;
                                const pctValue = (context.parsed.x || 0).toFixed(1);

                                // Retrieve raw count mapping
                                let rawCount = 0;
                                const rawStats = percentages[originalIndex].raw;
                                if (datasetLabel?.startsWith('Q1')) rawCount = rawStats.Q1;
                                else if (datasetLabel?.startsWith('Q2')) rawCount = rawStats.Q2;
                                else if (datasetLabel?.startsWith('Q3')) rawCount = rawStats.Q3;
                                else if (datasetLabel?.startsWith('Q4')) rawCount = rawStats.Q4;
                                else if (datasetLabel?.startsWith('Unassigned')) rawCount = rawStats.NA;

                                return ` ${datasetLabel}: ${pctValue}% (${rawCount} papers)`;
                            },
                        }
                    }
                }
            }
        });
    }

    /**
     * Legacy method kept for compatibility if needed elsewhere
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
     * Initialize the Geographic Collaboration Map using D3.js
     */
    initializeGeoMap(): void {
        if (!this.analyticsData?.geoCollaboration || !this.geoMapContainer) return;

        const container = this.geoMapContainer.nativeElement;
        d3.select(container).selectAll('*').remove();

        const width = container.clientWidth || 800;
        const height = 450;

        const svg = d3.select(container)
            .append('svg')
            .attr('width', '100%')
            .attr('height', height)
            .attr('viewBox', `0 0 ${width} ${height}`)
            .style('cursor', 'grab');

        // Clip path to keep map inside bounds
        svg.append('defs').append('clipPath')
            .attr('id', 'map-clip')
            .append('rect')
            .attr('width', width)
            .attr('height', height);

        const mapG = svg.append('g')
            .attr('class', 'map-g')
            .attr('clip-path', 'url(#map-clip)');

        const projection = d3.geoNaturalEarth1()
            .scale(width / 6.5)
            .translate([width / 2, height / 2]);

        const path = d3.geoPath().projection(projection);

        const colorScale = d3.scaleSequential(d3.interpolateBlues)
            .domain([0, d3.max(this.analyticsData.geoCollaboration, d => d.count) || 10]);

        // ── D3 Zoom behaviour (no scroll-wheel zoom) ──
        const zoom = d3.zoom<SVGSVGElement, unknown>()
            .scaleExtent([0.5, 8])
            .filter((event) => event.type !== 'wheel')   // disable scroll zoom
            .on('zoom', (event) => {
                mapG.attr('transform', event.transform);
                svg.style('cursor', event.type === 'mousedown' ? 'grabbing' : 'grab');
            });

        (svg as any).call(zoom);

        // ── Zoom control buttons ──
        const btnGroup = d3.select(container)
            .append('div')
            .style('position', 'absolute')
            .style('top', '12px')
            .style('right', '14px')
            .style('display', 'flex')
            .style('flex-direction', 'column')
            .style('gap', '4px')
            .style('z-index', '10');

        const btnStyle = (el: any) => el
            .style('width', '30px')
            .style('height', '30px')
            .style('border', '1.5px solid #e2e8f0')
            .style('border-radius', '8px')
            .style('background', 'white')
            .style('box-shadow', '0 2px 6px rgba(0,0,0,0.1)')
            .style('cursor', 'pointer')
            .style('font-size', '18px')
            .style('line-height', '28px')
            .style('text-align', 'center')
            .style('color', '#4f46e5')
            .style('font-weight', '700')
            .style('transition', 'background 0.2s');

        btnStyle(btnGroup.append('button').text('+'))
            .on('click', () => (svg as any).transition().duration(300).call(zoom.scaleBy, 1.5));

        btnStyle(btnGroup.append('button').text('−'))
            .on('click', () => (svg as any).transition().duration(300).call(zoom.scaleBy, 0.67));

        btnStyle(btnGroup.append('button').html('&#8635;')
            .style('font-size', '14px'))
            .on('click', () => (svg as any).transition().duration(400).call(zoom.transform, d3.zoomIdentity));

        // Set the container itself to position:relative so buttons overlay correctly
        d3.select(container).style('position', 'relative');

        // Load world map data
        d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then((data: any) => {
            const countries = topojson.feature(data, data.objects.countries) as any;

            // TopoJSON name → common name stored in DB
            // TopoJSON name (lowercase) → name as stored in backend
            const nameAlias: Record<string, string> = {
                'united states of america': 'united states',
                'russia': 'russian federation',
                'south korea': 'south korea',
                'north korea': 'north korea',
                'czech republic': 'czechia',
                'dr congo': 'democratic republic of the congo',
                'congo': 'republic of the congo',
                'bosnia and herz.': 'bosnia and herzegovina',
                's. sudan': 'south sudan',
                'central african rep.': 'central african republic',
                'eq. guinea': 'equatorial guinea',
                'solomon is.': 'solomon islands',
            };

            // Find collaboration: exact match first, then alias, no fuzzy
            const findCollab = (mapName: string) => {
                const lower = mapName.toLowerCase();
                const alias = (nameAlias[lower] || '').toLowerCase();
                return this.analyticsData?.geoCollaboration?.find(c => {
                    const cl = c.country.toLowerCase();
                    return cl === lower || (alias && cl === alias);
                });
            };

            mapG.selectAll('path')
                .data(countries.features)
                .enter().append('path')
                .attr('d', (d: any) => path(d))
                .attr('fill', (d: any) => {
                    const collab = findCollab(d.properties.name);
                    return collab ? colorScale(collab.count) : '#f1f5f9';
                })
                .attr('stroke', '#cbd5e1')
                .attr('stroke-width', 0.5)
                .append('title')
                .text((d: any) => {
                    const collab = findCollab(d.properties.name);
                    return `${d.properties.name}${collab ? `: ${collab.count} collaborations` : ''}`;
                });

            // Highlight India (Sharda University)
            mapG.selectAll('path')
                .filter((d: any) => d.properties.name === 'India')
                .attr('fill', '#4f46e5')
                .attr('stroke', '#3730a3')
                .attr('stroke-width', 1);
        });
    }

    /**
     * Initialize the Inter-Departmental Collaboration Heatmap using D3.js
     */
    initializeCollaborationHeatmap(): void {
        const networkData = this.analyticsData?.collaborationNetwork;
        if (!networkData || !this.collaborationContainer || !networkData.nodes.length) return;

        const container = this.collaborationContainer.nativeElement;
        d3.select(container).selectAll('*').remove();

        const departments = networkData.nodes.map(n => n.id);
        const margin = { top: 120, right: 30, bottom: 30, left: 180 };
        const cellSize = 22;
        const width = departments.length * cellSize;
        const height = departments.length * cellSize;

        // Prepare matrix data for heatmap
        const heatmapData: any[] = [];
        departments.forEach((deptA, i) => {
            departments.forEach((deptB, j) => {
                let weight = 0;
                if (i === j) {
                    weight = 0; // Don't show self-collaboration in heatmap
                } else {
                    const link = networkData.links.find(l =>
                        (l.source === deptA && l.target === deptB) ||
                        (l.source === deptB && l.target === deptA)
                    );
                    weight = link ? link.weight : 0;
                }
                heatmapData.push({ x: deptA, y: deptB, value: weight });
            });
        });

        const svg = d3.select(container)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Build X scales and axis
        const x = d3.scaleBand()
            .range([0, width])
            .domain(departments)
            .padding(0.05);

        svg.append('g')
            .style('font-size', '10px')
            .style('font-weight', '500')
            .attr('transform', `translate(0, 0)`)
            .call(d3.axisTop(x).tickSize(0))
            .select('.domain').remove();

        svg.selectAll('.tick text')
            .attr('transform', 'rotate(-45)')
            .style('text-anchor', 'start')
            .attr('dx', '.8em')
            .attr('dy', '-.5em')
            .attr('fill', '#64748b');

        // Build Y scales and axis
        const y = d3.scaleBand()
            .range([0, height])
            .domain(departments)
            .padding(0.05);

        svg.append('g')
            .style('font-size', '10px')
            .style('font-weight', '500')
            .call(d3.axisLeft(y).tickSize(0))
            .select('.domain').remove();

        svg.selectAll('.tick text')
            .attr('fill', '#64748b');

        // Build color scale
        const maxVal = d3.max(heatmapData, d => d.value) || 1;
        const colorScale = d3.scaleSequential()
            .interpolator(d3.interpolateBlues)
            .domain([0, maxVal]);

        // Add the cells
        svg.selectAll()
            .data(heatmapData)
            .enter()
            .append('rect')
            .attr('x', d => x(d.x)!)
            .attr('y', d => y(d.y)!)
            .attr('rx', 3)
            .attr('ry', 3)
            .attr('width', x.bandwidth())
            .attr('height', y.bandwidth())
            .style('fill', d => d.value === 0 ? '#f8fafc' : colorScale(d.value))
            .style('stroke-width', 1)
            .style('stroke', 'white')
            .append('title')
            .text(d => `${d.x} & ${d.y}: ${d.value} collaborations`);
    }

    /**
     * Initialize the Date Trend Chart (Bar or Line depending on range)
     */
    initializeDateTrendChart(): void {
        const trendData = this.analyticsData?.dateTrendData;
        if (!trendData || !this.dateTrendCanvas || !trendData.length) return;

        if (this.dateTrendChart) {
            this.dateTrendChart.destroy();
        }

        const ctx = this.dateTrendCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        // Determine if it's Monthly (YYYY-MM) or Daily (YYYY-MM-DD) or Yearly
        const isDaily = trendData[0].label.length > 7;
        const labels = trendData.map(d => {
            if (isDaily) {
                // "2025-05-15" -> "15 May"
                const parts = d.label.split('-');
                if (parts.length === 3) {
                    const monthInfo = this.months.find(m => m.value === parseInt(parts[1]));
                    return `${parts[2]} ${monthInfo?.name.substring(0, 3)}`;
                }
            } else if (d.label.length === 7) {
                // "2025-05" -> "May 2025"
                const parts = d.label.split('-');
                if (parts.length === 2) {
                    const monthInfo = this.months.find(m => m.value === parseInt(parts[1]));
                    return `${monthInfo?.name.substring(0, 3)} ${parts[0]}`;
                }
            }
            return d.label; // Fallback to YYYY
        });
        const counts = trendData.map(d => d.count);

        const gradient = ctx.createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.85)'); // Vibrant Purple
        gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.4)');
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0.05)');

        const totalDuration = 2000;
        const delayBetweenPoints = totalDuration / counts.length;

        const config: ChartConfiguration = {
            type: isDaily ? 'bar' : 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Papers Published',
                    data: counts,
                    backgroundColor: gradient, // Always use gradient for more pop
                    borderColor: '#8b5cf6',
                    borderWidth: isDaily ? 0 : 4, // Thicker line
                    borderRadius: isDaily ? 4 : 0,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#8b5cf6',
                    pointBorderWidth: 3,
                    pointRadius: 5,
                    pointHoverRadius: 8,
                    fill: !isDaily,
                    tension: isDaily ? 0 : 0.45 // Smoother curve
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 2500,
                    easing: 'easeOutQuart'
                },
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        padding: 12,
                        titleFont: { size: 14, weight: 'bold' },
                        bodyFont: { size: 13 },
                        callbacks: {
                            label: (context) => ` Publications: ${context.parsed.y}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0, 0, 0, 0.05)' },
                        ticks: { font: { size: 11 }, precision: 0 }
                    }
                }
            }
        };

        this.dateTrendChart = new Chart(ctx, config);
    }

    /**
     * Initialize the Research Topic Evolution Trends using Chart.js
     */
    initializeTopicTrends(): void {
        const data = this.analyticsData?.topicEvolution;
        if (!data || !this.topicTrendsContainer || !data.length) return;

        // Ensure chart does not redraw over old canvas object indefinitely
        if (this.topicTrendsChart) {
            this.topicTrendsChart.destroy();
        }

        const ctx = this.topicTrendsContainer.nativeElement.getContext('2d');
        if (!ctx) return;

        // Determine format and parse readable labels just like dateTrendData
        const isDaily = data[0].period.length > 7;
        const labels = data.map((d: any) => {
            if (isDaily) {
                // "2025-05-15" -> "15 May"
                const parts = d.period.split('-');
                if (parts.length === 3) {
                    const monthInfo = this.months.find(m => m.value === parseInt(parts[1]));
                    return `${parts[2]} ${monthInfo?.name.substring(0, 3)}`;
                }
            } else if (d.period.length === 7) {
                // "2025-05" -> "May 2025"
                const parts = d.period.split('-');
                if (parts.length === 2) {
                    const monthInfo = this.months.find(m => m.value === parseInt(parts[1]));
                    return `${monthInfo?.name.substring(0, 3)} ${parts[0]}`;
                }
            }
            return d.period; // Fallback to YYYY
        });

        // Find top 5 general keywords that appear across periods
        const kwTotal: any = {};
        data.forEach((d: any) => {
            d.topics.forEach((t: any) => {
                kwTotal[t.keyword] = (kwTotal[t.keyword] || 0) + t.count;
            });
        });

        const topKeywords = Object.entries(kwTotal)
            .sort((a: any, b: any) => b[1] - a[1])
            .slice(0, 5)
            .map(e => e[0]);

        const datasets = topKeywords.map((kw, idx) => {
            const colors = [
                '#6366f1', // Indigo
                '#10b981', // Emerald
                '#f59e0b', // Amber
                '#ef4444', // Red
                '#8b5cf6', // Violet
                '#06b6d4', // Cyan
                '#ec4899'  // Pink
            ];

            const color = colors[idx % colors.length];

            // Create gradient
            const gradient = ctx.createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, color + '99'); // 60% opacity for vibrant look
            gradient.addColorStop(0.5, color + '44');
            gradient.addColorStop(1, color + '05'); // Barely visible at bottom

            return {
                label: kw,
                data: data.map((yearData: any) => {
                    const topic = yearData.topics.find((t: any) => t.keyword === kw);
                    return topic ? topic.count : 0;
                }),
                borderColor: color,
                backgroundColor: gradient,
                borderWidth: 4, // Thicker line
                pointBackgroundColor: color,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 8,
                fill: true,
                tension: 0.45 // Softer curves
            };
        });

        // Animation config for progressive drawing
        const totalDuration = 3000;
        const delayBetweenPoints = labels.length > 0 ? totalDuration / labels.length : 0;
        const animation = {
            x: {
                type: 'number',
                easing: 'linear',
                duration: delayBetweenPoints,
                from: NaN,
                delay(ctx: any) {
                    if (ctx.type !== 'data' || ctx.xStarted) return 0;
                    ctx.xStarted = true;
                    return ctx.index * delayBetweenPoints;
                }
            },
            y: {
                type: 'number',
                easing: 'linear',
                duration: delayBetweenPoints,
                from: (ctx: any) => {
                    return ctx.index === 0 ? ctx.chart.scales.y.getPixelForValue(0) : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(['y'], true).y;
                },
                delay(ctx: any) {
                    if (ctx.type !== 'data' || ctx.yStarted) return 0;
                    ctx.yStarted = true;
                    return ctx.index * delayBetweenPoints;
                }
            }
        };

        this.topicTrendsChart = new Chart(ctx, { // Save instance
            type: 'line',
            data: {
                labels: labels, // Use formatted labels instead of raw years
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: animation as any, // Progressive drawing
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'end',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            padding: 20,
                            font: { size: 12, weight: 500 }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#1e293b',
                        bodyColor: '#475569',
                        borderColor: '#e2e8f0',
                        borderWidth: 1,
                        padding: 12,
                        boxPadding: 8,
                        usePointStyle: true,
                        callbacks: {
                            label: function (context: any) {
                                return ` ${context.dataset.label}: ${context.parsed.y} papers`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: '#f1f5f9' },
                        ticks: {
                            font: { size: 11 },
                            stepSize: 1
                        },
                        title: {
                            display: true,
                            text: 'Publications Count',
                            font: { size: 12, weight: 600 }
                        }
                    }
                }
            }
        });
    }

    /**
     * Initialize the Quartile Distribution Chart (Polar Area)
     */
    initializeQuartileChart(): void {
        if (!this.analyticsData || !this.quartileChartCanvas || !this.analyticsData.quartileDistribution) return;
        if (this.quartileChart) this.quartileChart.destroy();

        const ctx = this.quartileChartCanvas.nativeElement.getContext('2d');
        if (!ctx) return;

        const data = this.analyticsData.quartileDistribution;
        // Ensure order Q1, Q2, Q3, Q4, Others
        const order = ['Q1', 'Q2', 'Q3', 'Q4', 'NA'];
        const displayLabels: { [key: string]: string } = {
            'Q1': 'Q1 (High)',
            'Q2': 'Q2',
            'Q3': 'Q3',
            'Q4': 'Q4',
            'NA': 'Others / Non-Indexed'
        };

        const sortedData = order.map(q => {
            const item = data.find(d => d.quartile.toUpperCase() === q);
            const count = item ? item.count : 0;
            const label = q === 'NA' ? `Others (${count})` : `${q} (${count})`;
            return { quartile: label, count: count };
        });

        const colors = [
            'rgb(16, 185, 129)',  // Q1 - Green
            'rgb(59, 130, 246)',  // Q2 - Blue
            'rgb(245, 158, 11)',  // Q3 - Orange
            'rgb(239, 68, 68)',   // Q4 - Red
            'rgba(148, 163, 184, 0.4)' // Others - Subtle Slate
        ];

        this.quartileChart = new Chart(ctx, {
            type: 'polarArea',
            data: {
                labels: sortedData.map(d => d.quartile),
                datasets: [{
                    data: sortedData.map(d => d.count),
                    backgroundColor: colors.map(c => c.includes('rgba') ? c : c.replace('rgb', 'rgba').replace(')', ', 0.75)')),
                    borderColor: colors.map(c => c.includes('rgba') ? c.replace('0.4', '0.6') : c),
                    borderWidth: 1
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
                            font: { size: 11, family: "'Inter', sans-serif" }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        padding: 12,
                        cornerRadius: 8,
                        callbacks: {
                            label: (context) => ` ${context.label}: ${context.parsed.r} publications`
                        }
                    }
                },
                scales: {
                    r: {
                        ticks: { display: false },
                        grid: { color: 'rgba(0, 0, 0, 0.05)' }
                    }
                }
            }
        });
    }


    // --- BATTLE MODE LOGIC ---
    private loadGlobalStatsForBattle(): void {
        this.paperService.getAnalytics(undefined, this.startDate || undefined, this.endDate || undefined)
            .subscribe({
                next: (res) => {
                    if (res.success && res.data?.departments) {
                        this.allDepartmentsStats = res.data.departments;
                        // Pre-calculate just in case
                        this.allDepartmentsStats.forEach((dept, index) => {
                            dept.percentage = Math.round((dept.paperCount / (res.data.totalPapers || 1)) * 100);
                            dept.colorClass = this.calculateColorClass(index);
                        });
                        this.initializeBattleMode();
                    }
                }
            });
    }

    initializeBattleMode(): void {
        const ctx = this.battleChartCanvas?.nativeElement?.getContext('2d');
        if (!this.analyticsData || !this.battleChartCanvas || !ctx) return;

        if (this.battleChart) this.battleChart.destroy();

        // Use global stats if available, otherwise fallback to current analytics
        const deptSource = this.allDepartmentsStats.length > 0 ? this.allDepartmentsStats : this.analyticsData.departments;
        if (!deptSource || deptSource.length === 0) return;

        // Smart selection: pick two different ones if currently the same or uninitialized
        if (!this.battleDept1) this.battleDept1 = deptSource[0]?.department;
        if (!this.battleDept2 || (this.battleDept1 === this.battleDept2 && deptSource.length > 1)) {
            this.battleDept2 = deptSource.length > 1 ? (deptSource[1].department === this.battleDept1 ? deptSource[0].department : deptSource[1].department) : deptSource[0]?.department;
        }

        const dept1 = this.getBattleDeptData(this.battleDept1);
        const dept2 = this.getBattleDeptData(this.battleDept2);

        if (!dept1 || !dept2) return;

        // Set labels if not set
        if (!this.battleDept1) this.battleDept1 = dept1.department;
        if (!this.battleDept2) this.battleDept2 = dept2.department;

        const metrics = ['Paper Count', 'Total Citations', 'Unique Authors', 'Avg Citations', 'Q1 Ratio (%)'];

        const data1 = [
            dept1.paperCount || 0,
            dept1.totalCitations || 0,
            dept1.uniqueAuthors || 0,
            dept1.paperCount > 0 ? (dept1.totalCitations || 0) / dept1.paperCount : 0,
            dept1.paperCount > 0 ? ((dept1.quartiles?.Q1 || 0) / dept1.paperCount) * 100 : 0
        ];

        const data2 = [
            dept2.paperCount || 0,
            dept2.totalCitations || 0,
            dept2.uniqueAuthors || 0,
            dept2.paperCount > 0 ? (dept2.totalCitations || 0) / dept2.paperCount : 0,
            dept2.paperCount > 0 ? ((dept2.quartiles?.Q1 || 0) / dept2.paperCount) * 100 : 0
        ];

        // Prepare metric row data for template
        this.battleMetricsData = [
            this.createMetricRow('Paper Count', data1[0], data2[0]),
            this.createMetricRow('Total Citations', data1[1], data2[1]),
            this.createMetricRow('Unique Authors', data1[2], data2[2]),
            this.createMetricRow('Q1 Papers', dept1.quartiles?.Q1 || 0, dept2.quartiles?.Q1 || 0)
        ];

        // Normalize data for radar chart visualization (scale 0-100)
        const normalize = (val: number, max: number) => (val / (max || 1)) * 100;
        const normalized1 = data1.map((v, i) => normalize(v, Math.max(data1[i], data2[i])));
        const normalized2 = data2.map((v, i) => normalize(v, Math.max(data1[i], data2[i])));

        this.battleChart = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: metrics,
                datasets: [
                    {
                        label: dept1.department,
                        data: normalized1,
                        backgroundColor: 'rgba(99, 102, 241, 0.2)',
                        borderColor: '#6366f1',
                        borderWidth: 3,
                        pointBackgroundColor: '#6366f1',
                    },
                    {
                        label: dept2.department,
                        data: normalized2,
                        backgroundColor: 'rgba(236, 72, 153, 0.2)',
                        borderColor: '#ec4899',
                        borderWidth: 3,
                        pointBackgroundColor: '#ec4899',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    r: {
                        beginAtZero: true,
                        max: 100,
                        ticks: { display: false },
                        grid: { color: 'rgba(226, 232, 240, 0.5)' }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: '#475569',
                            font: { size: 12, weight: 'bold' }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context: any) => {
                                const index = context.dataIndex;
                                const originalVal = context.datasetIndex === 0 ? data1[index] : data2[index];
                                return `${context.dataset.label}: ${originalVal.toFixed(1)}${index === 4 ? '%' : ''}`;
                            }
                        }
                    }
                }
            }
        });

        // Trigger CD since we modified battleMetricsData
        this.cdr.detectChanges();
    }

    private createMetricRow(label: string, v1: number, v2: number) {
        const total = v1 + v2 || 1;
        return {
            label,
            value1: v1,
            value2: v2,
            percent1: (v1 / total) * 100,
            percent2: (v2 / total) * 100
        };
    }

    getBattleDeptData(deptName: string): DepartmentStats | undefined {
        const source = this.allDepartmentsStats.length > 0 ? this.allDepartmentsStats : this.analyticsData?.departments;
        return source?.find(d => d.department === deptName);
    }

    onBattleChange(): void {
        this.initializeBattleMode();
    }

    // --- 3D NEXUS LOGIC ---
    toggleTopicView(view: 'cloud' | 'nexus'): void {
        this.activeTopicView = view;
        if (view === 'nexus') {
            setTimeout(() => this.initialize3DNexus(), 0);
        }
    }

    initialize3DNexus(): void {
        const network = this.analyticsData?.keywordNetwork;
        if (!network || !this.nexusContainer || this.activeTopicView !== 'nexus') return;

        if (this.nexusGraph) {
            // ForceGraph3D doesn't have a direct destructor in some versions, 
            // but we can clear the container and re-init
            this.nexusContainer.nativeElement.innerHTML = '';
        }

        const container = this.nexusContainer.nativeElement;

        // @ts-ignore
        this.nexusGraph = ForceGraph3D()(container)
            .graphData({
                nodes: network.nodes,
                links: network.links
            })
            .nodeLabel('name')
            .nodeAutoColorBy('id')
            .nodeRelSize(5)
            .nodeVal('val')
            .linkWidth('weight')
            .linkDirectionalParticles(2)
            .linkDirectionalParticleSpeed((d: any) => (d.weight || 1) * 0.01)
            .backgroundColor('rgba(0,0,0,0)') // Transparent to inherit card bg
            .showNavInfo(false)
            .width(container.clientWidth)
            .height(500);

        // Futuristic styling
        this.nexusGraph.onNodeClick((node: any) => {
            // Aim at node from outside
            const distance = 40;
            const distRatio = 1 + distance / Math.hypot(node.x || 1, node.y || 1, node.z || 1);

            this.nexusGraph.cameraPosition(
                { x: (node.x || 0) * distRatio, y: (node.y || 0) * distRatio, z: (node.z || 0) * distRatio }, // new pos
                node, // lookAt ({x,y,z})
                3000  // ms transition duration
            );
        });
    }

    /**
     * Navigate back to previous page
     */
    goBack(): void {
        this.location.back();
    }
}
