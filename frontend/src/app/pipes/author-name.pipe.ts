import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'authorName',
    standalone: true
})
export class AuthorNamePipe implements PipeTransform {
    /**
     * Format author name from "Last, First" to "First Last"
     * @param name - The name string to format
     * @returns Formatted name
     */
    transform(name: string | undefined | null): string {
        if (!name) return '-';

        // Check if name contains a comma
        if (name.includes(',')) {
            const parts = name.split(',');
            if (parts.length >= 2) {
                const lastName = parts[0].trim();
                const firstName = parts[1].trim();
                return `${firstName} ${lastName}`;
            }
        }

        // Otherwise return as is
        return name;
    }
}
