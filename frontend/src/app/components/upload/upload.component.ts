import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { PaperService } from '../../services/paper.service';
import { ApiResponse } from '../../models/paper.model';

interface UploadResultData {
  count: number;
  papersWithSharda: number;
}

import { NavbarComponent } from '../navbar/navbar.component';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, RouterLink, NavbarComponent],
  templateUrl: './upload.component.html',
  styleUrls: ['./upload.component.css']
})
export class UploadComponent {
  // File selection state
  selectedFile: File | null = null;
  isDragging = false;

  // Loading and error states
  isUploading = false;
  uploadSuccess = false;
  errorMessage = '';
  uploadResult: ApiResponse<UploadResultData> | null = null;

  constructor(
    private paperService: PaperService,
    private router: Router,
    private location: Location
  ) { }

  /**
   * Navigate back to previous page
   */
  goBack(): void {
    this.location.back();
  }

  /**
   * Handle file selection via input
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectFile(input.files[0]);
    }
  }

  /**
   * Handle drag over event
   */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  /**
   * Handle drag leave event
   */
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  /**
   * Handle file drop event
   */
  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      this.selectFile(event.dataTransfer.files[0]);
    }
  }

  /**
   * Process the selected file
   */
  private selectFile(file: File): void {
    // Reset states
    this.errorMessage = '';
    this.uploadSuccess = false;
    this.uploadResult = null;

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.errorMessage = 'Please select a CSV file';
      return;
    }

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      this.errorMessage = 'File size must be less than 50MB';
      return;
    }

    this.selectedFile = file;
  }

  /**
   * Upload the selected CSV file
   */
  uploadFile(): void {
    if (!this.selectedFile) return;

    this.isUploading = true;
    this.errorMessage = '';

    this.paperService.uploadCSV(this.selectedFile).subscribe({
      next: (response) => {
        this.isUploading = false;
        this.uploadSuccess = true;
        this.uploadResult = response;

        // Navigate to papers list after successful upload
        setTimeout(() => {
          this.router.navigate(['/papers']);
        }, 1500);
      },
      error: (error) => {
        this.isUploading = false;
        this.errorMessage = error.error?.message || 'Failed to upload file. Please try again.';
      }
    });
  }

  /**
   * Clear selected file
   */
  clearFile(): void {
    this.selectedFile = null;
    this.errorMessage = '';
    this.uploadSuccess = false;
    this.uploadResult = null;
  }
}

