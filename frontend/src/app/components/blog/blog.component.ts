import { Component, AfterViewInit, ElementRef, QueryList, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface BlogPost {
    title: string;
    category: string;
    author: string;
    department: string;
    date: string;
    excerpt: string;
    imageUrl: string;
}

@Component({
    selector: 'app-blog',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './blog.component.html',
    styleUrls: ['./blog.component.css']
})
export class BlogComponent implements AfterViewInit {
    @ViewChildren('paperCard') paperCards!: QueryList<ElementRef>;

    // Data
    categories: string[] = ['All', 'Engineering', 'Medical', 'Management', 'Law', 'Computer Science'];
    activeCategory: string = 'All';

    allPosts: BlogPost[] = [
        {
            title: 'AI-Driven Diagnosis of Retinal Diseases Using Deep Learning',
            category: 'Medical',
            author: 'Dr. Anita Sharma',
            department: 'School of Medical Sciences & Research',
            date: 'Oct 12, 2025',
            excerpt: 'Exploring novel convolutional neural networks to identify early markers of diabetic retinopathy and macular degeneration from retinal fundus images with 98% accuracy.',
            imageUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80'
        },
        {
            title: 'Blockchain-Based Supply Chain Transparency Framework',
            category: 'Engineering',
            author: 'Prof. Rajesh Kumar',
            department: 'School of Engineering and Technology',
            date: 'Nov 05, 2025',
            excerpt: 'A decentralized approach to agricultural supply chains in India, utilizing smart contracts to ensure fairness for farmers and traceability for consumers.',
            imageUrl: 'https://images.unsplash.com/photo-1518770660439-4636190af475?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80'
        },
        {
            title: 'Impact of GST on SMEs in Uttar Pradesh',
            category: 'Management',
            author: 'Dr. Vikram Singh',
            department: 'School of Business Studies',
            date: 'Dec 02, 2025',
            excerpt: 'An empirical analysis of compliance costs, operational challenges, and long-term economic benefits observed among small manufacturing enterprises over a 5-year period.',
            imageUrl: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80'
        },
        {
            title: 'Legal Frameworks for Cybercrime in India',
            category: 'Law',
            author: 'Prof. Anjali Desai',
            department: 'School of Law',
            date: 'Jan 15, 2026',
            excerpt: 'Analyzing the efficacy of the IT Act (2000) against modern financial cyber fraud, deepfakes, and data privacy breaches in the context of recent Supreme Court rulings.',
            imageUrl: 'https://images.unsplash.com/photo-1589829085413-56de8ae18c73?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80'
        },
        {
            title: 'Quantum Computing Applications in Cryptography',
            category: 'Computer Science',
            author: 'Dr. Siddharth Rao',
            department: 'Dept of Computer Science & Engineering',
            date: 'Feb 10, 2026',
            excerpt: 'A comprehensive study on post-quantum cryptographic algorithms and their integration into existing TLS protocols to counteract Shor\'s algorithm vulnerabilities.',
            imageUrl: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80'
        },
        {
            title: 'Sustainable Architecture in Smart Cities',
            category: 'Engineering',
            author: 'Prof. Meera Patel',
            department: 'School of Architecture and Planning',
            date: 'Feb 18, 2026',
            excerpt: 'Integrating IoT sensors and dynamic shading facades to reduce HVAC energy consumption by 40% in high-rise commercial buildings in tropical climates.',
            imageUrl: 'https://images.unsplash.com/photo-1518005020951-eccb494ad742?ixlib=rb-4.0.3&auto=format&fit=crop&w=600&q=80'
        }
    ];

    filteredPosts: BlogPost[] = [...this.allPosts];

    ngAfterViewInit(): void {
        // Setup Intersection Observer for scrolling animations
        const observerOptions = {
            root: null,
            rootMargin: '0px',
            threshold: 0.15
        };

        const observer = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target); // Only animate once
                }
            });
        }, observerOptions);

        // Observe immediately, and we will do it again on filter change
        setTimeout(() => {
            this.paperCards.forEach(card => observer.observe(card.nativeElement));
        }, 100);
    }

    setCategory(category: string): void {
        this.activeCategory = category;
        if (category === 'All') {
            this.filteredPosts = [...this.allPosts];
        } else {
            this.filteredPosts = this.allPosts.filter(post => post.category === category);
        }

        // Re-apply animations when filtering changes DOM elements
        setTimeout(() => {
            const cards = document.querySelectorAll('.paper-card');
            cards.forEach((card, index) => {
                // Reset classes
                card.classList.remove('visible');

                // Stagger entrance manually for filter changes
                setTimeout(() => {
                    card.classList.add('visible');
                }, index * 100);
            });
        }, 50);
    }

    // Get color for category badge
    getCategoryColor(category: string): string {
        const colors: { [key: string]: string } = {
            'Medical': '#ec4899',       // Pink
            'Engineering': '#3b82f6',   // Blue
            'Management': '#10b981',    // Green
            'Law': '#f59e0b',           // Amber
            'Computer Science': '#8b5cf6' // Violet
        };
        return colors[category] || '#64748b'; // Slate default
    }
}
