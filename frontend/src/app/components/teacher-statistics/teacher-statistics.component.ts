import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PaperService } from '../../services/paper.service';
import { Chart, registerables } from 'chart.js';
import { Subject, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, takeUntil } from 'rxjs/operators';
import { HostListener } from '@angular/core';

Chart.register(...registerables);

interface AuthorStat {
    _id: string;
    department: string;
    paperCount: number;
    citationCount: number;
    scopusId?: string;
}

interface DetailedStats {
    name: string;
    department: string;
    totalPapers: number;
    totalCitations: number;
    hIndex: number;
    scopusId?: string;
    coauthorCount?: number;
    validation?: {
        isValid: boolean;
        warnings: string[];
    };
    officialProfile?: {
        name: string;
        scopusId?: string;
        documentCount: number;
        citationCount: number;
        hIndex: number;
        coauthorCount: number;
        link?: string;
    };
    yearlyStats: { [key: string]: number };
    quartiles: { Q1: number; Q2: number; Q3: number; Q4: number; NA: number };
    collaborationNetwork: {
        nodes: any[];
        links: any[];
    };
    papers: Array<{
        paperTitle: string;
        year: number;
        publicationDate?: string | Date;
        citedBy: number;
        sourcePaper?: string;
        publisher?: string;
        link?: string;
        paperType?: string;
        quartile?: string;
    }>;
}

import * as d3 from 'd3';

import { AuthorNamePipe } from '../../pipes/author-name.pipe';

@Component({
    selector: 'app-teacher-statistics',
    standalone: true,
    imports: [CommonModule, FormsModule, AuthorNamePipe],
    templateUrl: './teacher-statistics.component.html',
    styleUrls: ['./teacher-statistics.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class TeacherStatisticsComponent implements OnInit, OnDestroy {
    searchQuery: string = '';
    authors: AuthorStat[] = [];
    selectedAuthor: DetailedStats | null = null;
    isLoading: boolean = true;
    loadingMessage: string = 'Loading statistics...';
    hasSearched: boolean = false;
    private chart: Chart | null = null;

    // Year & Type filter for paper list
    selectedYear: number | null = null;
    activeTeacherPaperType: string = '';

    get filteredPapersByYear(): any[] {
        if (!this.selectedAuthor) return [];
        let papers = this.selectedAuthor.papers;
        if (this.selectedYear) {
            papers = papers.filter(p => p.year === this.selectedYear);
        }
        if (this.activeTeacherPaperType) {
            papers = papers.filter(p => (p.paperType || 'Unknown') === this.activeTeacherPaperType);
        }
        return papers;
    }

    get paperTypeDistribution(): { type: string, count: number }[] {
        if (!this.selectedAuthor) return [];
        let papers = this.selectedAuthor.papers;
        if (this.selectedYear) {
            papers = papers.filter(p => p.year === this.selectedYear);
        }
        const counts: { [key: string]: number } = {};
        papers.forEach(p => {
            const t = p.paperType || 'Unknown';
            counts[t] = (counts[t] || 0) + 1;
        });
        return Object.entries(counts)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count);
    }

    get filteredTotalPapers(): number {
        return this.filteredPapersByYear.length;
    }

    get filteredTotalCitations(): number {
        return this.filteredPapersByYear.reduce((sum, p) => sum + (p.citedBy || 0), 0);
    }

    get filteredHIndex(): number {
        const citations = this.filteredPapersByYear.map(p => p.citedBy || 0).sort((a, b) => b - a);
        let hIndex = 0;
        for (let i = 0; i < citations.length; i++) {
            if (citations[i] >= i + 1) {
                hIndex = i + 1;
            } else {
                break;
            }
        }
        return hIndex;
    }

    get filteredQuartiles(): { Q1: number; Q2: number; Q3: number; Q4: number; NA: number } {
        const quartiles = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NA: 0 };
        this.filteredPapersByYear.forEach(p => {
            const q = (p.quartile || 'NA').toUpperCase().trim();
            if (['Q1', 'Q2', 'Q3', 'Q4'].includes(q)) {
                quartiles[q as keyof typeof quartiles]++;
            } else {
                quartiles.NA++;
            }
        });
        return quartiles;
    }

    get computedYearlyStats(): { [key: string]: number } {
        if (!this.selectedAuthor) return {};
        let papers = this.selectedAuthor.papers;
        if (this.activeTeacherPaperType) {
            papers = papers.filter(p => (p.paperType || 'Unknown') === this.activeTeacherPaperType);
        }
        const stats: { [key: string]: number } = {};
        papers.forEach(p => {
            const y = p.year || 'Unknown';
            stats[y] = (stats[y] || 0) + 1;
        });
        return stats;
    }

    selectYear(year: number | null): void {
        this.selectedYear = this.selectedYear === year ? null : year;
        this.cdr.markForCheck();
        setTimeout(() => this.renderChart(), 0);
    }

    selectTeacherPaperType(type: string): void {
        this.activeTeacherPaperType = this.activeTeacherPaperType === type ? '' : type;
        this.cdr.markForCheck();
        setTimeout(() => this.renderChart(), 0);
    }

    // Suggestions state
    suggestions: AuthorStat[] = [];
    showSuggestions: boolean = false;
    private searchSubject = new Subject<string>();
    private destroy$ = new Subject<void>();

    constructor(
        private paperService: PaperService,
        private route: ActivatedRoute,
        private cdr: ChangeDetectorRef
    ) { }

    ngOnInit(): void {
        // Setup debounced search suggestions
        this.searchSubject.pipe(
            debounceTime(300),
            distinctUntilChanged(),
            switchMap(query => {
                if (!query.trim()) {
                    this.suggestions = [];
                    this.showSuggestions = false;
                    this.cdr.markForCheck();
                    return of([]);
                }
                return this.paperService.searchAuthors(query);
            }),
            takeUntil(this.destroy$)
        ).subscribe(data => {
            this.suggestions = data;
            this.showSuggestions = data.length > 0;
            this.cdr.markForCheck();
        });

        // Check for _id query parameter to load author details directly
        this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
            const authorName = params['_id'];
            if (authorName) {
                this.searchQuery = authorName;
                this.viewStats(authorName);
            }
        });

        // Simple delay to ensure smooth transition and show loader
        setTimeout(() => {
            this.isLoading = false;
            this.cdr.markForCheck();
        }, 500);
    }

    ngOnDestroy(): void {
        this.destroyChart();
        this.destroy$.next();
        this.destroy$.complete();
    }

    onQueryChange(): void {
        // Reset search state when user modifies the query
        this.hasSearched = false;
        this.searchSubject.next(this.searchQuery);
    }

    selectSuggestion(author: AuthorStat): void {
        this.searchQuery = author._id;
        this.showSuggestions = false;
        this.authors = [author]; // Instantly populate the grid with the selected author
        this.viewStats(author.scopusId || author._id);
    }

    @HostListener('document:click', ['$event'])
    onClickOutside(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (!target.closest('.search-wrapper')) {
            this.showSuggestions = false;
            this.cdr.markForCheck();
        }
    }

    search(): void {
        if (!this.searchQuery.trim()) return;
        const queryStr = this.searchQuery.trim();
        this.loadingMessage = 'Searching authors...';
        this.isLoading = true;
        this.hasSearched = false;
        this.selectedAuthor = null;
        this.authors = [];

        // Check if query is a numeric Scopus ID
        if (/^\d{5,15}$/.test(queryStr)) {
            this.viewStats(queryStr);
            return;
        }

        this.paperService.searchAuthors(queryStr).subscribe({
            next: (data) => {
                this.authors = data;
                this.isLoading = false;
                this.hasSearched = true;

                if (data && data.length > 0) {
                    // Check if there is an exact case-insensitive match for the query name
                    const exactMatch = data.find(author => author._id.toLowerCase() === queryStr.toLowerCase());
                    if (exactMatch) {
                        this.viewStats(exactMatch._id);
                    } else if (data.length === 1) {
                        // Or if there is only 1 result returned
                        this.viewStats(data[0]._id);
                    }
                }
                this.cdr.markForCheck();
            },
            error: (err) => {
                console.error('Search failed', err);
                this.isLoading = false;
                this.hasSearched = true;
                this.cdr.markForCheck();
            }
        });
    }

    viewStats(authorName: string): void {
        this.loadingMessage = 'Loading author details...';
        this.isLoading = true;
        this.selectedYear = null;
        this.activeTeacherPaperType = '';
        this.paperService.getAuthorStats(authorName).subscribe({
            next: (data) => {
                this.selectedAuthor = data;
                this.isLoading = false;
                this.cdr.markForCheck();
                setTimeout(() => {
                    this.renderChart();
                    this.renderSynergyChord();
                }, 50);
            },
            error: (err) => {
                console.error('Stats failed', err);
                this.isLoading = false;
                this.cdr.markForCheck();
            }
        });
    }

    closeStats(): void {
        this.selectedAuthor = null;
        this.destroyChart();
        this.cdr.markForCheck();
    }

    trackByAuthorId(index: number, author: AuthorStat): string {
        return author._id || index.toString();
    }

    trackByPaperTitle(index: number, paper: any): string {
        return paper.paperTitle || index.toString();
    }

    /**
     * Legacy method placeholder (logic moved to AuthorNamePipe)
     */
    formatAuthorName(name: string | undefined | null): string {
        if (!name) return '-';
        return name; // The pipe handles formatting in the template
    }

    private destroyChart(): void {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }

    private renderChart(): void {
        if (!this.selectedAuthor) return;
        const ctx = document.getElementById('yearChart') as HTMLCanvasElement;
        if (!ctx) return;

        this.destroyChart();

        const yearlyStats = this.computedYearlyStats;
        const years = Object.keys(yearlyStats).sort();
        const counts = years.map(y => yearlyStats[y]);

        this.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: years,
                datasets: [{
                    label: 'Papers',
                    data: counts,
                    backgroundColor: years.map(y => {
                        const isSelected = this.selectedYear === parseInt(y, 10);
                        if (this.selectedYear === null) {
                            return 'rgba(99, 102, 241, 0.7)';
                        }
                        return isSelected ? 'rgba(99, 102, 241, 0.95)' : 'rgba(99, 102, 241, 0.2)';
                    }),
                    borderColor: 'rgba(129, 140, 248, 1)',
                    borderWidth: 1.5,
                    borderRadius: 6,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: (_event: any, elements: any[]) => {
                    if (elements.length > 0) {
                        const idx = elements[0].index;
                        const clickedYear = parseInt(years[idx], 10);
                        this.selectYear(clickedYear);
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(19, 19, 31, 0.95)',
                        borderColor: 'rgba(99, 102, 241, 0.4)',
                        borderWidth: 1,
                        titleColor: '#e0e7ff',
                        bodyColor: '#94a3b8',
                        padding: 10,
                        callbacks: {
                            label: (ctx) => ` ${ctx.parsed.y} paper${ctx.parsed.y !== 1 ? 's' : ''}`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', font: { size: 11 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#64748b', precision: 0, font: { size: 11 } }
                    }
                }
            }
        });
    }
    private renderSynergyChord(): void {
        if (!this.selectedAuthor || !this.selectedAuthor.collaborationNetwork) return;
        const container = document.getElementById('synergyGraph');
        if (!container || !this.selectedAuthor.collaborationNetwork.nodes.length) return;

        // Clear previous graph
        container.innerHTML = '';

        const width = container.clientWidth || 330;
        const height = 400;
        const outerRadius = Math.min(width, height) * 0.5 - 60;
        const innerRadius = outerRadius - 10;

        const svg = d3.select('#synergyGraph')
            .append('svg')
            .attr('width', width)
            .attr('height', height)
            .append('g')
            .attr('transform', `translate(${width / 2},${height / 2})`);

        const { nodes, links } = this.selectedAuthor.collaborationNetwork;
        const n = nodes.length;

        // Create Matrix for Chord
        const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
        const indexMap = new Map(nodes.map((node, i) => [node.id, i]));

        links.forEach(link => {
            const i = indexMap.get(link.source);
            const j = indexMap.get(link.target);
            if (i !== undefined && j !== undefined) {
                matrix[i][j] = link.value;
                matrix[j][i] = link.value;
            }
        });

        // If very few links, add dummy values to make the circle look full but subtle
        if (links.length < 5) {
            for (let i = 0; i < n; i++) matrix[i][i] = 0.5;
        }

        const chord = d3.chord()
            .padAngle(0.05)
            .sortSubgroups(d3.descending)(matrix);

        const arc = d3.arc<any, d3.ChordGroup>()
            .innerRadius(innerRadius)
            .outerRadius(outerRadius);

        const ribbon = d3.ribbon<any, d3.Chord>()
            .radius(innerRadius);

        // Define Gradients for Ribbons
        const defs = svg.append('defs');

        // Colors
        const colors = ['#6366f1', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#f97316', '#06b6d4', '#84cc16', '#22c55e'];

        // Arcs (Outer Ring)
        const group = svg.append('g')
            .selectAll('g')
            .data(chord.groups)
            .join('g');

        group.append('path')
            .attr('fill', d => colors[d.index % colors.length])
            .attr('stroke', d => d3.rgb(colors[d.index % colors.length]).darker().toString())
            .attr('d', arc as any);

        // Labels
        group.append('text')
            .each(d => { (d as any).angle = (d.startAngle + d.endAngle) / 2; })
            .attr('dy', '.35em')
            .attr('transform', d => `
                rotate(${(d as any).angle * 180 / Math.PI - 90})
                translate(${outerRadius + 10})
                ${(d as any).angle > Math.PI ? 'rotate(180)' : ''}
            `)
            .attr('text-anchor', d => (d as any).angle > Math.PI ? 'end' : 'start')
            .text(d => {
                const name = nodes[d.index].name || nodes[d.index].id;
                const parts = name.split(' ');
                return parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : name;
            })
            .attr('fill', '#e2e8f0')
            .attr('font-size', '10px')
            .style('font-weight', d => nodes[d.index].isTarget ? 'bold' : 'normal');

        // Ribbons
        svg.append('g')
            .attr('fill-opacity', 0.67)
            .selectAll('path')
            .data(chord)
            .join('path')
            .attr('d', ribbon as any)
            .attr('fill', d => colors[d.source.index % colors.length])
            .attr('stroke', d => d3.rgb(colors[d.source.index % colors.length]).darker().toString())
            .style('mix-blend-mode', 'screen')
            .style('cursor', 'pointer')
            .on('mouseover', function (event, d) {
                d3.select(this).attr('fill-opacity', 1);
            })
            .on('mouseout', function (event, d) {
                d3.select(this).attr('fill-opacity', 0.67);
            });

        // Add dummy center glow
        svg.append('circle')
            .attr('r', innerRadius - 20)
            .attr('fill', 'url(#centerGlow)')
            .style('pointer-events', 'none')
            .attr('opacity', 0.1);

        const radialGradient = defs.append('radialGradient')
            .attr('id', 'centerGlow');
        radialGradient.append('stop').attr('offset', '0%').attr('stop-color', '#6366f1');
        radialGradient.append('stop').attr('offset', '100%').attr('stop-color', 'transparent');
    }
}
