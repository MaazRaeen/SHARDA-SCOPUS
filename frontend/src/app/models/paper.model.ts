/**
 * Paper Model (Legacy - for reference)
 */
export interface Paper {
  _id: string;
  title: string;
  year: number;
  authors: string[];
  affiliations: string[];
  source: string;
  doi: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Consolidated Paper Author
 */
export interface ConsolidatedAuthor {
  authorName: string;
  department: string;
  scopusId?: string;
}

/**
 * Consolidated Paper Interface
 * Represents a paper with up to 3 authors and their departments
 * Additional authors (beyond 3) are available in the authors array
 */
export interface ConsolidatedPaper {
  id?: string;
  _id?: string; // Standardize on _id if using MongoDB
  paperTitle: string;
  year?: number;
  sourcePaper: string;
  publisher: string;
  doi: string;
  link: string;
  paperType: string;
  citedBy: number;
  authorCount: number;
  authors: ConsolidatedAuthor[];
  author1?: ConsolidatedAuthor;
  author2?: ConsolidatedAuthor;
  author3?: ConsolidatedAuthor;
  quartile?: string;
  publicationDate?: string;
}

/**
 * Upload Response Interface
 */
export interface UploadResponse {
  success: boolean;
  message: string;
  count: number;
  papersWithSharda?: number;
  errors?: Array<{ row: any; error: string }>;
}

/**
 * Sharda Author Model
 * Represents a Sharda University author with their department
 */
export interface ShardaAuthor {
  _id: string;
  authorName: string;
  department: string;
  scopusId?: string;
  sourcePaper?: string;
  publisher?: string;
  paperTitle?: string;
  year?: number;
  paperType?: string;
  quartile?: string;
  allPaperTitles: string[];
  allPaperNames: string[];
  allPaperTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Scopus Search Parameters
 */
export interface ScopusSearchParams {
  query: string;
  maxResults?: number;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * API Response Interface
 */
export interface ApiResponse<T> {
  success: boolean;
  count?: number; // total count across all pages
  total?: number; // same as count
  page?: number;  // current page index
  limit?: number; // items per page
  totalPages?: number;
  startIndex?: number;
  itemsPerPage?: number;
  totalResults?: number;
  message?: string;
  data?: T;
  departments?: string[];
  years?: number[];
  paperTypes?: string[];
  filters?: {
    departments: string[];
    years: number[];
    paperTypes: string[];
  };
  error?: string;
}

