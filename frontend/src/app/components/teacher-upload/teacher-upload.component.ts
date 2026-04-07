import { Component } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-teacher-upload',
    standalone: true,
    imports: [CommonModule, RouterLink, FormsModule],
    templateUrl: './teacher-upload.component.html',
    styleUrl: './teacher-upload.component.css'
})
export class TeacherUploadComponent {
    isDragging = false;
    selectedFile: File | null = null;
    fileError: string = '';

    constructor(private location: Location) { }

    /**
     * Handle file selection via click
     */
    onFileSelected(event: any): void {
        const file = event.target.files[0];
        this.handleFile(file);
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
     * Handle drop event
     */
    onDrop(event: DragEvent): void {
        event.preventDefault();
        event.stopPropagation();
        this.isDragging = false;

        if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
            this.handleFile(event.dataTransfer.files[0]);
        }
    }

    /**
     * Process the selected file
     */
    private handleFile(file: File): void {
        this.fileError = '';

        if (!file) return;

        // Validate file type
        const validTypes = [
            'application/pdf',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv'
        ];

        // Check file extension as a fallback
        const fileName = file.name.toLowerCase();
        const isValidExtension = fileName.endsWith('.pdf') ||
            fileName.endsWith('.xls') ||
            fileName.endsWith('.xlsx') ||
            fileName.endsWith('.csv');

        if (!validTypes.includes(file.type) && !isValidExtension) {
            this.fileError = 'Please upload a valid CSV, Excel, or PDF file.';
            this.selectedFile = null;
            return;
        }

        this.selectedFile = file;
        console.log('File selected:', this.selectedFile.name);
    }

    /**
     * Remove selected file
     */
    removeFile(): void {
        this.selectedFile = null;
        this.fileError = '';
    }

    /**
     * Navigate back
     */
    goBack(): void {
        this.location.back();
    }

    /**
     * Simulate upload process
     */
    uploadFile(): void {
        if (!this.selectedFile) return;

        alert(`File "${this.selectedFile.name}" would be uploaded here.`);
        // Here you would typically call a service to upload the file
    }

    // Manual Entry Form Data
    teacherName: string = '';
    teacherId: string = '';
    department: string = '';
    manualEntryError: string = '';
    manualEntrySuccess: string = '';

    /**
     * Handle manual entry submission
     */
    updateManualEntry(): void {
        this.manualEntryError = '';
        this.manualEntrySuccess = '';

        if (!this.teacherName.trim() || !this.teacherId.trim() || !this.department.trim()) {
            this.manualEntryError = 'Please fill in all fields.';
            return;
        }

        // Simulate update process
        console.log('Manual Entry:', {
            name: this.teacherName,
            id: this.teacherId,
            department: this.department
        });

        this.manualEntrySuccess = 'Teacher details updated successfully (Simulation).';

        // Clear form after success
        setTimeout(() => {
            this.teacherName = '';
            this.teacherId = '';
            this.department = '';
            this.manualEntrySuccess = '';
        }, 3000);
    }

    // UI State
    activeTab: 'upload' | 'manual' = 'upload';

    setActiveTab(tab: 'upload' | 'manual'): void {
        this.activeTab = tab;
    }
}
