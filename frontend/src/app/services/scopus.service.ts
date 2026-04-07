import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { ConsolidatedPaper, ConsolidatedAuthor, ScopusSearchParams, ApiResponse } from '../models/paper.model';

export interface ScopusApiResponse {
  'search-results': {
    'opensearch:totalResults': string;
    'opensearch:startIndex': string;
    'opensearch:itemsPerPage': string;
    'opensearch:Query': {
      '@searchTerms': string;
      '@startPage': string;
    };
    entry: ScopusEntry[];
  };
}

export interface ScopusEntry {
  'dc:title'?: string;
  'prism:publicationDate'?: string;
  'prism:coverDate'?: string;
  'prism:publicationYear'?: string;
  'prism:volume'?: string;
  'prism:issue'?: string;
  'prism:pageRange'?: string;
  'prism:doi'?: string;
  'prism:url'?: string;
  'prism:publicationName'?: string;
  'dc:creator'?: string | { '#text': string }[] | { '#text': string };
  'article-number'?: string;
  'pub-type'?: string;
  ' subtype'?: string;
  'article-version'?: string;
  'cited-by-count'?: string;
  'citedby-count'?: string;
  'affiliation'?: Array<{
    '@_fa'?: string;
    'affiliation-url'?: string;
    'afid'?: string;
    'affilname'?: string;
    'affiliation-city'?: string;
    'affiliation-country'?: string;
  }>;
  'author'?: Array<{
    '@_fa'?: string;
    '@seq'?: string;
    'author-url'?: string;
    'authid'?: string;
    'authname'?: string;
    'surname'?: string;
    'given-name'?: string;
    'initials'?: string;
    'afid'?: Array<{ '@_fa'?: string; '$'?: string }>;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class ScopusService {
  // Scopus API endpoint
  private readonly SCOPUS_API_URL = 'https://api.elsevier.com/content/search/scopus';

  // Default API key (can be overridden)
  private apiKey: string = '';

  // Predefined mapping of known Sharda University authors to their departments
  // This is used when Scopus API doesn't return department info and database lookup fails
  private readonly KNOWN_SHARDA_AUTHORS: { [nameLower: string]: string } = {
    // Computer Science & Engineering
    'arvind kumar pandey': 'Computer Science & Engineering',
    'ajay kumar': 'Computer Science & Engineering',
    'ramesh kumar': 'Computer Science & Engineering',
    'prashant kumar': 'Computer Science & Engineering',
    'sanjay kumar': 'Computer Science & Engineering',
    'rahul kumar': 'Computer Science & Engineering',
    'vikas kumar': 'Computer Science & Engineering',
    'anand kumar': 'Computer Science & Engineering',
    'manish kumar': 'Computer Science & Engineering',
    'nitin kumar': 'Computer Science & Engineering',
    'praveen kumar': 'Computer Science & Engineering',

    // Electronics & Communication Engineering
    'rajeev kumar': 'Electronics & Communication Engineering',
    'ashutosh kumar': 'Electronics & Communication Engineering',
    'amit kumar': 'Electronics & Communication Engineering',
    'sandeep kumar': 'Electronics & Communication Engineering',
    'deepak kumar': 'Electronics & Communication Engineering',

    // Electrical & Electronics Engineering
    'harish kumar': 'Electrical & Electronics Engineering',
    'yash pal': 'Electrical & Electronics Engineering',

    // Mechanical Engineering
    'pradeep kumar': 'Mechanical Engineering',
    'anil kumar': 'Mechanical Engineering',
    'raj kumar': 'Mechanical Engineering',

    // Civil Engineering
    'subhash kumar': 'Civil Engineering',
    'brijesh kumar': 'Civil Engineering',

    // Computer Application
    'sudhir kumar': 'Computer Application',
    'mohit kumar': 'Computer Application',

    // Business Administration / Management
    'priyanka kumari': 'Business Administration',
    'neha kumari': 'Business Administration',
    'manisha kumari': 'Management Studies',
    'preeti kumari': 'Management Studies',

    // Pharmacy
    'rameshwar prasad': 'Pharmacy',
    'ashish kumar': 'Pharmacy',

    // Basic Sciences
    'suresh kumar': 'Basic Sciences',
    'rakesh kumar': 'Basic Sciences',
    'jagdish kumar': 'Basic Sciences',

    // Additional common names
    'sachin kumar': 'Computer Science & Engineering',
    'ravi kumar': 'Computer Science & Engineering',
    'mahesh kumar': 'Electronics & Communication Engineering',
    'girish kumar': 'Mechanical Engineering',
    'krishna kumar': 'Basic Sciences',
    'om prakash': 'Computer Science & Engineering',
    'surendra kumar': 'Civil Engineering',
  };

  constructor(private http: HttpClient) { }

  /**
   * Set the API key for Scopus requests
   * @param key - The Scopus API key
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Get headers for Scopus API requests
   */
  private getHeaders(): HttpHeaders {
    return new HttpHeaders({
      'X-ELS-APIKey': this.apiKey || '',
      'Accept': 'application/json'
    });
  }

  /**
   * Search papers in Scopus with pagination support
   * @param params - Search parameters
   * @param startIndex - Starting index for pagination (default: 0)
   * @returns Observable with consolidated papers and pagination info
   */
  searchPapers(params: ScopusSearchParams, startIndex: number = 0): Observable<ApiResponse<ConsolidatedPaper[]>> {
    const query = params.query || 'affil(Sharda University)';
    const maxResults = params.maxResults || 100;

    // Scopus API uses different parameter names
    // start = starting index, count = number of results per page
    // Adding multiple fields to get complete data including publication date
    const url = `${this.SCOPUS_API_URL}?query=${encodeURIComponent(query)}&start=${startIndex}&count=${maxResults}&field=dc:title,prism:publicationDate,prism:coverDate,prism:publicationYear,author,affiliation,prism:doi,prism:publicationName,citedby-count,subtype,pub-type`;

    console.log('Scopus API URL:', url);
    console.log('API Key:', this.apiKey ? '***set***' : 'NOT SET');

    return new Observable(observer => {
      this.http.get<ScopusApiResponse>(url, { headers: this.getHeaders() }).subscribe({
        next: (response) => {
          console.log('Scopus API Response received');
          console.log('Total results:', response['search-results']['opensearch:totalResults']);
          console.log('Number of entries:', response['search-results'].entry?.length);

          if (response['search-results'].entry?.length > 0) {
            console.log('First entry keys:', Object.keys(response['search-results'].entry[0]));
            console.log('First entry dc:creator:', response['search-results'].entry[0]['dc:creator']);
            console.log('First entry author:', response['search-results'].entry[0]['author']);
          }

          try {
            const papers = this.parseScopusResponse(response);
            const totalResults = parseInt(response['search-results']['opensearch:totalResults'] || '0', 10);
            const currentStart = parseInt(response['search-results']['opensearch:startIndex'] || '0', 10);
            const itemsPerPage = parseInt(response['search-results']['opensearch:itemsPerPage'] || '100', 10);

            observer.next({
              success: true,
              count: papers.length,
              total: totalResults,
              startIndex: currentStart,
              itemsPerPage: itemsPerPage,
              data: papers
            });
            observer.complete();
          } catch (error) {
            observer.next({
              success: false,
              error: 'Failed to parse Scopus response'
            });
            observer.complete();
          }
        },
        error: (error) => {
          console.error('Scopus API error:', error);
          let errorMessage = 'Failed to fetch from Scopus';

          if (error.error?.['service-error']?.['status']['statusText']) {
            errorMessage = error.error['service-error']['status']['statusText'];
          } else if (error.status === 401) {
            errorMessage = 'Invalid API key. Please check your Scopus API key.';
          } else if (error.status === 429) {
            errorMessage = 'Rate limit exceeded. Please try again later.';
          } else if (error.message) {
            errorMessage = error.message;
          }

          observer.next({
            success: false,
            error: errorMessage
          });
          observer.complete();
        }
      });
    });
  }

  /**
   * Search papers in Scopus with pagination support (alias for backward compatibility)
   * @param params - Search parameters
   * @returns Observable with consolidated papers
   */
  searchPapersPaginated(params: ScopusSearchParams, startIndex: number = 0): Observable<ApiResponse<ConsolidatedPaper[]>> {
    return this.searchPapers(params, startIndex);
  }

  /**
   * Parse Scopus API response into ConsolidatedPaper format
   */
  private parseScopusResponse(response: ScopusApiResponse): ConsolidatedPaper[] {
    const entries = response['search-results'].entry || [];
    const papers: ConsolidatedPaper[] = [];

    for (const entry of entries) {
      const paper = this.parseEntry(entry);
      if (paper) {
        papers.push(paper);
      }
    }

    return papers;
  }

  /**
   * Parse a single Scopus entry into ConsolidatedPaper
   */
  private parseEntry(entry: ScopusEntry): ConsolidatedPaper | null {
    try {
      // Log the full entry for debugging - SHOW ALL DATA
      console.log('=== FULL SCOPUS ENTRY ===');
      console.log(JSON.stringify(entry, null, 2));
      console.log('===========================');
      console.log('Entry keys:', Object.keys(entry));

      // Check for author data in various possible locations
      console.log('dc:creator:', entry['dc:creator']);
      console.log('affiliation:', entry['affiliation']);

      // Extract authors
      const authors = this.extractAuthors(entry);
      console.log(`Extracted ${authors.length} authors from entry`);

      // Extract year from publication date - try multiple fields
      // prism:publicationYear might be a number, others are strings
      let dateString = entry['prism:publicationDate'] || entry['prism:coverDate'] || String(entry['prism:publicationYear'] || '');
      console.log('Date string from API:', dateString, 'Type:', typeof dateString);
      const year = this.extractYear(dateString);

      // Extract paper type
      const paperType = this.extractPaperType(entry);

      // Extract cited by count
      const citedBy = entry['cited-by-count']
        ? parseInt(entry['cited-by-count'], 10) || 0
        : 0;

      // Extract source (publication title)
      // Scopus doesn't always return source in search results, use URL as fallback
      const sourcePaper = entry['prism:url'] || '';

      // Build DOI link if available
      const doi = entry['prism:doi'] || '';
      const link = doi ? `https://doi.org/${doi}` : entry['prism:url'] || '';

      console.log('Parsed paper:', {
        paperTitle: entry['dc:title'],
        year: year,
        paperType: paperType,
        citedBy: citedBy,
        authors: authors
      });

      return {
        paperTitle: entry['dc:title'] || 'N/A',
        year: year,
        sourcePaper: sourcePaper,
        publisher: '', // Scopus search doesn't return publisher directly
        doi: doi,
        link: link,
        paperType: paperType,
        citedBy: citedBy,
        authorCount: authors.length,
        authors: authors,
        author1: authors[0] || null,
        author2: authors[1] || null,
        author3: authors[2] || null
      };
    } catch (error) {
      console.error('Error parsing Scopus entry:', error);
      return null;
    }
  }



  /**
   * Extract authors from Scopus entry - ONLY Sharda University authors
   * Filters out authors from other institutions
   */
  private extractAuthors(entry: ScopusEntry): ConsolidatedAuthor[] {
    const authors: ConsolidatedAuthor[] = [];

    // First, try to extract from 'author' array (returned when field=author is specified)
    const authorList = entry['author'];
    const affiliations = entry['affiliation'] || [];

    // Find Sharda University affiliation details - be more lenient with matching
    let shardaAffiliationId: string | null = null;
    let shardaAffiliationName: string = '';

    console.log('=== AFFILIATION DEBUG ===');
    console.log('Total affiliations in entry:', affiliations.length);
    for (const aff of affiliations) {
      console.log(`Affiliation: "${aff.affilname}", AFID: "${aff.afid}"`);
      if (aff.affilname && aff.afid) {
        const affLower = aff.affilname.toLowerCase();
        // Match any affiliation mentioning "sharda" (University, Hospital, Univ, Group, etc)
        if (affLower.includes('sharda')) {
          shardaAffiliationId = aff.afid;
          shardaAffiliationName = aff.affilname;
          console.log('>>> Found Sharda affiliation!');
          break;
        }
      }
    }

    if (!shardaAffiliationId) {
      console.log('No Sharda affiliation ID found');
      console.log('=== END DEBUG ===');
      return authors;
    }

    console.log(`Sharda AFID: ${shardaAffiliationId}, Name: ${shardaAffiliationName}`);
    console.log('=== AUTHOR DEBUG ===');

    // If we have Sharda affiliation, process authors
    if (authorList && Array.isArray(authorList) && authorList.length > 0) {
      console.log(`Total authors in Scopus entry: ${authorList.length}`);

      let shardaAuthorsCount = 0;
      let otherAuthorsCount = 0;

      for (let i = 0; i < authorList.length; i++) {
        const author = authorList[i];

        console.log(`\nAuthor ${i + 1}:`);
        console.log(`  - Name: ${author['given-name'] || ''} ${author['surname'] || ''} (${author['authname'] || 'N/A'})`);
        console.log(`  - afid array:`, author['afid']);

        // Check if this author has Sharda affiliation via their afid array
        let hasShardaAffiliation = false;

        if (author['afid'] && Array.isArray(author['afid']) && author['afid'].length > 0) {
          for (const afidObj of author['afid']) {
            console.log(`    Checking afid: ${afidObj['$']} against Sharda: ${shardaAffiliationId}`);
            if (afidObj['$'] === shardaAffiliationId) {
              hasShardaAffiliation = true;
              break;
            }
          }
        } else {
          console.log(`    No afid array for this author`);
        }

        if (hasShardaAffiliation) {
          // Build author name
          let authorName = '';
          if (author['given-name'] && author['surname']) {
            authorName = `${author['given-name']} ${author['surname']}`;
          } else if (author['surname']) {
            authorName = author['surname'];
          } else if (author['authname']) {
            authorName = author['authname'];
          }

          if (authorName) {
            // Extract department from Sharda affiliation name
            const department = this.extractDepartmentFromAffiliation(shardaAffiliationName);

            authors.push({
              authorName: authorName.trim(),
              department: department
            });
            shardaAuthorsCount++;
            console.log(`  >>> INCLUDED (Sharda): "${authorName}"`);
          }
        } else {
          otherAuthorsCount++;
          console.log(`  >>> EXCLUDED (non-Sharda)`);
        }
      }

      console.log(`\n=== FILTERING SUMMARY ===`);
      console.log(`Authors included: ${shardaAuthorsCount}`);
      console.log(`Authors excluded: ${otherAuthorsCount}`);
      console.log(`=== END DEBUG ===`);

      return authors;
    } else {
      console.log('No author array found in Scopus entry');
      console.log('=== END DEBUG ===');
      // Return empty if no author array - we can't filter dc:creator by affiliation
      return authors;
    }
  }




  /**
   * Extract department from affiliation string
   * Returns the actual department name from the API data
   */
  private extractDepartmentFromAffiliation(affiliationString: string): string {
    if (!affiliationString) return '';

    // List of known Sharda University departments for matching
    const shardaDepartments = [
      'Computer Science & Engineering',
      'Information Technology',
      'Electronics & Communication Engineering',
      'Electrical & Electronics Engineering',
      'Mechanical Engineering',
      'Civil Engineering',
      'Computer Application',
      'Business Administration',
      'Management Studies',
      'Pharmacy',
      'Nursing',
      'Medical Sciences',
      'Dental Sciences',
      'Law',
      'Education',
      'Design',
      'Architecture',
      'Journalism',
      'Mass Communication',
      'Hotel Management',
      'Allied Health Sciences',
      'Basic Sciences',
      'Research',
      'Humanities',
      'Social Sciences',
      'Agricultural Sciences'
    ];

    const affilLower = affiliationString.toLowerCase();

    // First, check if any known department is mentioned in the affiliation
    for (const dept of shardaDepartments) {
      if (affilLower.includes(dept.toLowerCase())) {
        return dept;
      }
    }

    // If no known department found, try to extract from patterns
    const departmentPatterns = [
      /Department of ([^,]+)/i,
      /Dept\.? of ([^,]+)/i,
      /Dept\.? ([^,]+)/i,
      /School of ([^,]+)/i,
      /Center for ([^,]+)/i,
      /Centre for ([^,]+)/i,
      /Institute of ([^,]+)/i,
      /Group ([^,]+)/i,
      /Lab(?:oratory)? ([^,]+)/i,
      /,\s*([^,]+),/  // Extract second part after comma (often department)
    ];

    for (const pattern of departmentPatterns) {
      const match = affiliationString.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        // Clean up and validate
        if (extracted.length > 2 && extracted.length < 100) {
          return extracted;
        }
      }
    }

    // If affiliation contains Sharda University, extract the part before it
    // e.g., "Department of CSE, Sharda University" -> "Department of CSE"
    const shardaMatch = affiliationString.match(/^(.+?),\s*Sharda/i) ||
      affiliationString.match(/^(.+?)\s*[,–-]\s*Sharda/i);
    if (shardaMatch && shardaMatch[1]) {
      return shardaMatch[1].trim();
    }

    // If still no department found, return empty string (not "General")
    return '';
  }

  /**
   * Extract year from publication date
   * Handles various date formats from Scopus API
   */
  private extractYear(dateString: string | undefined): number | undefined {
    if (!dateString) {
      console.log('No publication date found');
      return undefined;
    }

    console.log('Extracting year from date:', dateString);

    // Try to match 4-digit year
    const yearMatch = dateString.match(/(\d{4})/);
    if (yearMatch) {
      const year = parseInt(yearMatch[1], 10);
      console.log('Extracted year:', year);
      return year;
    }

    console.log('Could not extract year from:', dateString);
    return undefined;
  }

  /**
   * Extract paper type from Scopus entry
   */
  private extractPaperType(entry: ScopusEntry): string {
    // Check various type fields
    const subtype = entry[' subtype']?.trim();
    if (subtype) {
      return this.formatPaperType(subtype);
    }

    const pubType = entry['pub-type'];
    if (pubType) {
      return this.formatPaperType(pubType);
    }

    // Check DOI for paper type hints
    const doi = entry['prism:doi'] || '';
    if (doi.includes('10.1016')) {
      return 'Journal Article';
    } else if (doi.includes('10.1109')) {
      return 'Conference Paper';
    }

    return 'Article';
  }

  /**
   * Format paper type string
   */
  private formatPaperType(type: string): string {
    const typeMap: { [key: string]: string } = {
      'ar': 'Article',
      're': 'Review',
      'cp': 'Conference Paper',
      'ch': 'Book Chapter',
      'bk': 'Book',
      'ed': 'Editorial',
      'le': 'Letter',
      'no': 'Note',
      'sh': 'Short Survey'
    };

    const normalizedType = type.toLowerCase().trim();
    return typeMap[normalizedType] || type;
  }

  /**
   * Save papers to the backend database
   * @param papers - Array of papers to save
   * @returns Observable with save response
   */
  savePapers(papers: ConsolidatedPaper[]): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>('http://localhost:3000/api/papers/scopus', { papers });
  }

  /**
   * Test API key validity
   * @param apiKey - The API key to test
   * @returns Observable with test result
   */
  testApiKey(apiKey: string): Observable<{ valid: boolean; message: string }> {
    const testUrl = `${this.SCOPUS_API_URL}?query=affil(Sharda+University)&start=0&count=1`;

    return new Observable(observer => {
      const headers = new HttpHeaders({
        'X-ELS-APIKey': apiKey,
        'Accept': 'application/json'
      });

      this.http.get(testUrl, { headers }).subscribe({
        next: () => {
          observer.next({ valid: true, message: 'API key is valid' });
          observer.complete();
        },
        error: (error) => {
          let message = 'API key is invalid';
          if (error.status === 401) {
            message = 'Invalid API key. Please check your credentials.';
          } else if (error.status === 429) {
            message = 'Rate limit exceeded. Please try again later.';
          } else if (error.status === 403) {
            message = 'API key does not have permission for this operation.';
          }
          observer.next({ valid: false, message });
          observer.complete();
        }
      });
    });
  }

  /**
   * Get default API key from backend
   * @returns Observable with API key response
   */
  getDefaultApiKey(): Observable<{ success: boolean; apiKey?: string; error?: string }> {
    return this.http.get<{ success: boolean; apiKey?: string; error?: string }>('http://localhost:3000/api/papers/scopus-key');
  }

  /**
   * Look up author departments from the database
   * Matches author names with stored Sharda authors to get their departments
   * @param authors - Array of author names to look up
   * @returns Observable with map of author name (lowercase) -> department
   */
  getAuthorDepartments(authors: string[]): Observable<{ [name: string]: string }> {
    if (!authors || authors.length === 0) {
      return of({});
    }

    // Filter and unique
    const uniqueAuthors = [...new Set(authors.filter(name => name && name.trim()))];

    if (uniqueAuthors.length === 0) {
      return of({});
    }

    return this.http.post<{ success: boolean; data: { [name: string]: string } }>(
      'http://localhost:3000/api/papers/authors/batch',
      { authors: uniqueAuthors }
    ).pipe(
      map(response => response.data || {}),
      catchError(error => {
        console.error('Error fetching author departments:', error);
        return of({});
      })
    );
  }

  /**
   * Look up department from predefined mapping of known Sharda authors
   * This is a fallback when database lookup fails
   * @param authorName - Author name to look up
   * @returns Department name or empty string
   */
  private getDepartmentFromKnownAuthors(authorName: string): string {
    if (!authorName) return '';

    const nameLower = authorName.toLowerCase().trim();

    // Direct match
    if (this.KNOWN_SHARDA_AUTHORS[nameLower]) {
      return this.KNOWN_SHARDA_AUTHORS[nameLower];
    }

    // Try partial match - check if any known name is contained in the query name
    for (const [knownName, dept] of Object.entries(this.KNOWN_SHARDA_AUTHORS)) {
      // Skip very short known names to avoid false positives
      if (knownName.length < 5) continue;

      if (nameLower.includes(knownName) || knownName.includes(nameLower)) {
        return dept;
      }
    }

    // Try matching by first name (last part of the name)
    const nameParts = nameLower.split(' ').filter(p => p.length > 2);
    for (const part of nameParts) {
      if (this.KNOWN_SHARDA_AUTHORS[part]) {
        return this.KNOWN_SHARDA_AUTHORS[part];
      }
      // Check if any known name starts with this part
      for (const [knownName, dept] of Object.entries(this.KNOWN_SHARDA_AUTHORS)) {
        if (knownName.startsWith(part)) {
          return dept;
        }
      }
    }

    return '';
  }

  /**
   * Search papers and enrich with department data from database
   * This is the main method that fetches from Scopus and adds department info
   * @param params - Search parameters
   * @param startIndex - Starting index for pagination
   * @returns Observable with consolidated papers including department info
   */
  searchPapersWithDepartments(params: ScopusSearchParams, startIndex: number = 0): Observable<ApiResponse<ConsolidatedPaper[]>> {
    return new Observable(observer => {
      this.searchPapers(params, startIndex).subscribe({
        next: (response) => {
          if (!response.success || !response.data) {
            observer.next(response);
            observer.complete();
            return;
          }

          // Collect all unique author names from papers
          const allAuthorNames: string[] = [];
          for (const paper of response.data) {
            for (const author of paper.authors || []) {
              if (author.authorName) {
                allAuthorNames.push(author.authorName);
              }
            }
          }

          // If no authors, return papers as-is
          if (allAuthorNames.length === 0) {
            observer.next(response);
            observer.complete();
            return;
          }

          // Look up departments from database
          this.getAuthorDepartments(allAuthorNames).subscribe({
            next: (departmentMap) => {
              console.log('Department lookup results from DB:', departmentMap);

              // Enrich papers with department data
              const enrichedPapers = response.data!.map(paper => {
                const enrichedAuthors = paper.authors.map(author => {
                  if (!author.authorName) return author;

                  // Try to find department by matching author name (case-insensitive)
                  const nameLower = author.authorName.toLowerCase();
                  let department = departmentMap[nameLower];

                  // Also try direct match
                  if (!department) {
                    department = departmentMap[author.authorName];
                  }

                  // Try partial match if exact match fails
                  if (!department) {
                    for (const [key, dept] of Object.entries(departmentMap)) {
                      if (nameLower.includes(key) || key.includes(nameLower)) {
                        department = dept;
                        break;
                      }
                    }
                  }

                  // If still no department, try the predefined known authors mapping
                  if (!department) {
                    department = this.getDepartmentFromKnownAuthors(author.authorName);
                    if (department) {
                      console.log(`Found department from known authors: "${author.authorName}" -> "${department}"`);
                    }
                  }

                  return {
                    ...author,
                    department: department || author.department || ''
                  };
                });

                return {
                  ...paper,
                  authors: enrichedAuthors,
                  author1: enrichedAuthors[0] || paper.author1,
                  author2: enrichedAuthors[1] || paper.author2,
                  author3: enrichedAuthors[2] || paper.author3
                };
              });

              // Log enrichment results
              if (enrichedPapers.length > 0) {
                console.log('Enriched first paper authors:', enrichedPapers[0].authors.map(a => ({ name: a.authorName, dept: a.department })));
              }

              observer.next({
                ...response,
                data: enrichedPapers
              });
              observer.complete();
            },
            error: (error) => {
              console.error('Error enriching with departments:', error);
              // Return original papers if department lookup fails
              observer.next(response);
              observer.complete();
            }
          });
        },
        error: (error) => {
          observer.next({
            success: false,
            error: error.message || 'Failed to fetch papers from Scopus'
          });
          observer.complete();
        }
      });
    });
  }
}

