import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ChatFloatingButtonComponent } from './components/chat-floating-button/chat-floating-button.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, ChatFloatingButtonComponent],
  template: `
    <div class="app-container">
      <router-outlet></router-outlet>
      <app-chat-floating-button></app-chat-floating-button>
    </div>
  `,
  styles: [`
    .app-container {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
  `]
})
export class AppComponent {
  title = 'Scopus Paper Processor';
}

