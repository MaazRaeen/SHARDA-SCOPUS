import { Component, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-chat-floating-button',
    standalone: true,
    imports: [CommonModule, HttpClientModule, FormsModule],
    templateUrl: './chat-floating-button.component.html',
    styleUrls: ['./chat-floating-button.component.css']
})
export class ChatFloatingButtonComponent implements AfterViewChecked {
    @ViewChild('chatMessages') private chatMessagesContainer!: ElementRef;

    isOpen = false;
    userQuery = '';
    isLoading = false;
    messages: Array<{ text: string, sender: 'user' | 'bot' }> = [
        { text: 'Hello! I am your AI Research Assistant. Ask me anything about Sharda University\'s research data.', sender: 'bot' }
    ];

    constructor(private http: HttpClient) { }

    ngAfterViewChecked() {
        this.scrollToBottom();
    }

    scrollToBottom(): void {
        try {
            this.chatMessagesContainer.nativeElement.scrollTop = this.chatMessagesContainer.nativeElement.scrollHeight;
        } catch (err) { }
    }

    toggleChat() {
        this.isOpen = !this.isOpen;
    }

    sendMessage() {
        if (!this.userQuery.trim()) return;

        const query = this.userQuery;
        this.messages.push({ text: query, sender: 'user' });
        this.userQuery = '';
        this.isLoading = true;

        this.http.post<any>('http://localhost:3000/api/papers/chat', { query })
            .subscribe({
                next: (res) => {
                    this.messages.push({ text: res.answer, sender: 'bot' });
                    this.isLoading = false;
                },
                error: (err) => {
                    this.messages.push({ text: 'Sorry, I encountered an error. Please try again.', sender: 'bot' });
                    this.isLoading = false;
                    console.error(err);
                }
            });
    }
}
