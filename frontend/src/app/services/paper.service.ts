import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap, delay } from 'rxjs';
import { ShardaAuthor, ApiResponse, ConsolidatedPaper } from '../models/paper.model';

@Injectable({
  providedIn: 'root'
})
export class PaperService {
  // Base API URL - change if backend runs on different port
  private readonly API_URL = 'http://localhost:3000/api/papers';

  // Cache stores
  private cache = new Map<string, any>();

  constructor(private http: HttpClient) { }

  /**
   * Clear the data cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Upload a CSV file for processing
   * @param file - The CSV file to upload
   * @returns Observable with upload response
   */
  uploadCSV(file: File): Observable<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<ApiResponse<any>>(`${this.API_URL}/upload`, formData).pipe(
      tap(() => this.clearCache())
    );
  }

  /**
   * Get all Sharda authors with optional filters
   * @param department - Filter by department (optional)
   * @param search - Search author names (optional)
   * @returns Observable with array of Sharda authors
   */
  getShardaAuthors(department?: string, search?: string): Observable<ApiResponse<ShardaAuthor[]>> {
    let url = `${this.API_URL}?`;
    if (department && department !== 'All') {
      url += `department=${encodeURIComponent(department)}&`;
    }
    if (search) {
      url += `search=${encodeURIComponent(search)}`;
    }
    url = url.replace(/[?&]$/, '');

    const cacheKey = `authors_${department || 'all'}_${search || ''}`;
    if (this.cache.has(cacheKey)) {
      return of(this.cache.get(cacheKey)).pipe(delay(0));
    }

    return this.http.get<ApiResponse<ShardaAuthor[]>>(url).pipe(
      tap(response => this.cache.set(cacheKey, response))
    );
  }

  /**
   * Get authors directly from Scopus API via backend proxy
   * @param start - Starting index
   * @param count - Number of records
   * @param search - Optional search query
   * @returns Observable with API response
   */
  getAuthorsFromApi(start: number = 0, count: number = 100, search: string = ''): Observable<ApiResponse<any[]>> {
    const url = `${this.API_URL}/authors-api?start=${start}&count=${count}&search=${search}`;
    return this.http.get<ApiResponse<any[]>>(url);
  }

  /**
   * Get aggregated author counts and papers per department using live Scopus API data
   * @param force - Force refresh the cache
   * @returns Observable with aggregated department data
   */
  getDepartmentApiCounts(force: boolean = false): Observable<ApiResponse<any[]>> {
    const url = `${this.API_URL}/department-api-counts?force=${force}`;
    return this.http.get<ApiResponse<any[]>>(url);
  }

  /**
   * Get all papers for a specific Scopus Author ID
   * @param scopusId - The Author Scopus ID
   * @param start - Starting index
   * @param count - Number of records
   * @returns Observable with list of papers
   */
  getAuthorPapersFromApi(scopusId: string, start: number = 0, count: number = 100): Observable<ApiResponse<any[]>> {
    const url = `${this.API_URL}/author-papers/${scopusId}?start=${start}&count=${count}`;
    return this.http.get<ApiResponse<any[]>>(url);
  }

  /**
   * Get papers for a list of authors (Department Papers)
   * @param scopusIds - List of Author Scopus IDs
   * @returns Observable with paper list
   */
  getDepartmentPapersFromApi(scopusIds: string[]): Observable<ApiResponse<any[]>> {
    const url = `${this.API_URL}/department-papers-api`;
    return this.http.post<ApiResponse<any[]>>(url, { scopusIds });
  }

  /**
   * Get department details (authors and papers) from PostgreSQL/Supabase
   * @param department - Department name
   * @returns Observable with department details
   */
  getDepartmentDetailsFromDb(department: string): Observable<ApiResponse<any>> {
    const url = `${this.API_URL}/department-details-db/${encodeURIComponent(department)}`;
    return this.http.get<ApiResponse<any>>(url);
  }

  /**
   * Get consolidated papers with up to 3 authors per paper
   * @param filters - Filter options
   * @returns Observable with array of consolidated papers
   */
  getConsolidatedPapers(filters?: {
    department?: string;
    year?: string;
    paperType?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }): Observable<ApiResponse<ConsolidatedPaper[]>> {
    let url = `${this.API_URL}/consolidated?`;
    let cacheKey = 'consolidated_';

    if (filters) {
      const { department, year, paperType, search, startDate, endDate, page, limit } = filters;
      if (department && department !== 'All') url += `department=${encodeURIComponent(department)}&`;
      if (year) url += `year=${encodeURIComponent(year)}&`;
      if (paperType && paperType !== 'All') url += `paperType=${encodeURIComponent(paperType)}&`;
      if (search) url += `search=${encodeURIComponent(search)}&`;
      if (startDate) url += `startDate=${encodeURIComponent(startDate)}&`;
      if (endDate) url += `endDate=${encodeURIComponent(endDate)}&`;
      if (page) url += `page=${page}&`;
      if (limit) url += `limit=${limit}&`;

      cacheKey += `${department || 'all'}_${year || 'all'}_${paperType || 'all'}_${search || ''}_${startDate || ''}_${endDate || ''}_${page || 1}_${limit || 50}`;
    } else {
      cacheKey += 'default';
    }

    url = url.replace(/[?&]$/, '');

    if (this.cache.has(cacheKey)) {
      return of(this.cache.get(cacheKey)).pipe(delay(0));
    }

    return this.http.get<ApiResponse<ConsolidatedPaper[]>>(url).pipe(
      tap(response => this.cache.set(cacheKey, response))
    );
  }

  /**
   * Get detailed lists of authors and publications grouped by department
   * @returns Observable with detailed department statistics
   */
  getDepartmentDetails(): Observable<ApiResponse<any[]>> {
    const url = `${this.API_URL}/department-details`;
    return this.http.get<ApiResponse<any[]>>(url);
  }

  /**
   * Get list of unique departments
   * @returns Observable with array of department names
   */
  getDepartments(): Observable<ApiResponse<string[]>> {
    const cacheKey = 'departments';
    if (this.cache.has(cacheKey)) {
      return of(this.cache.get(cacheKey)).pipe(delay(0));
    }

    return this.http.get<ApiResponse<string[]>>(`${this.API_URL}/departments`).pipe(
      tap(response => this.cache.set(cacheKey, response))
    );
  }

  /**
   * Download consolidated papers as CSV file
   */
  downloadConsolidatedCSV(): void {
    window.open(`${this.API_URL}/download/consolidated`, '_blank');
  }

  /**
   * Clear all authors from the database
   * @returns Observable with success response
   */
  clearAuthors(): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.API_URL}`).pipe(
      tap(() => this.clearCache())
    );
  }

  /**
   * Get analytics data for dashboard, optionally filtered by department
   * @param department - Optional department name to filter all stats
   * @returns Observable with analytics data
   */
  getAnalytics(department?: string, startDate?: string, endDate?: string): Observable<ApiResponse<any>> {
    const cacheKey = `analytics_${department || 'all'}_${startDate || 'no-start'}_${endDate || 'no-end'}`;

    const params = new URLSearchParams();
    if (department) params.set('department', department);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);

    const url = `${this.API_URL}/analytics?${params.toString()}`;

    return this.http.get<ApiResponse<any>>(url).pipe(
      tap(response => {
        if (!department && !startDate && !endDate) this.cache.set(cacheKey, response);
      })
    );
  }

  /**
   * Search authors by name
   */
  searchAuthors(query: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.API_URL}/authors/search?q=${encodeURIComponent(query)}`);
  }

  /**
   * Get detailed stats for a specific author
   */
  getAuthorStats(name: string): Observable<any> {
    return this.http.get<any>(`${this.API_URL}/authors/${encodeURIComponent(name)}/stats?_t=${Date.now()}`);
  }

  /**
   * Get cached Google Scholar lifetime stats for the logged-in user
   */
  getScholarData(): Observable<any> {
    const token = localStorage.getItem('token') || '';
    return this.http.get<any>(`${this.API_URL}/scholar/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  /**
   * Force refresh Google Scholar stats from SerpAPI (rate-limited: once per 24h)
   */
  refreshScholarData(): Observable<any> {
    const token = localStorage.getItem('token') || '';
    return this.http.post<any>(`${this.API_URL}/scholar/refresh`, {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  /**
   * Link or update the professor's Google Scholar profile URL
   */
  linkScholarUrl(scholarUrl: string): Observable<any> {
    const token = localStorage.getItem('token') || '';
    return this.http.post<any>(`${this.API_URL}/scholar/link`, { scholarUrl }, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  /**
   * Fetch ALL article titles/links/citations from Google Scholar for logged-in user
   */
  getScholarArticles(): Observable<any> {
    const token = localStorage.getItem('token') || '';
    return this.http.get<any>(`${this.API_URL}/scholar/articles`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
}
