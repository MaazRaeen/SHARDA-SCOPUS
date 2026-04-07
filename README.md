ter name="content">
# Scopus Paper Processor - MEAN Stack Application

A complete MEAN stack application that processes Scopus CSV files and filters research data for Sharda University authors.

## Features

- 📤 Upload Scopus CSV files
- 🔍 Filter papers by Sharda University affiliation
- 💾 Store filtered data in MongoDB
- 📥 Download filtered data as CSV
- 🎨 Modern, responsive UI

## Tech Stack

- **MongoDB** - Database
- **Express.js** - Backend framework
- **Angular** - Frontend framework
- **Node.js** - Runtime environment

## Prerequisites

- Node.js (v18 or higher)
- MongoDB (local or Atlas)
- Angular CLI

## Project Structure

```
SHARDA-PROJECT/
├── backend/
│   ├── config/
│   │   └── db.js              # MongoDB connection
│   ├── controllers/
│   │   └── paperController.js # CSV processing logic
│   ├── models/
│   │   └── Paper.js           # Mongoose schema
│   ├── routes/
│   │   └── paperRoutes.js     # API routes
│   ├── uploads/               # Temporary upload storage
│   ├── .env                   # Environment variables
│   ├── server.js              # Express server
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── app/
    │   │   ├── components/
    │   │   │   ├── upload/        # File upload component
    │   │   │   └── paper-list/    # Papers table component
    │   │   ├── models/
    │   │   │   └── paper.model.ts # TypeScript interfaces
    │   │   ├── services/
    │   │   │   └── paper.service.ts
    │   │   ├── app.component.ts
    │   │   ├── app.config.ts
    │   │   └── app.routes.ts
    │   ├── index.html
    │   ├── main.ts
    │   └── styles.css
    ├── angular.json
    ├── package.json
    └── tsconfig.json
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/papers/upload` | Upload and process CSV |
| GET | `/api/papers` | Get all filtered papers |
| GET | `/api/papers/download` | Download as CSV |
| DELETE | `/api/papers` | Clear all papers |

## Setup Instructions

### 1. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file (already created)
# Edit .env to set your MongoDB URI

# Start the server
npm start
```

The server will run on `http://localhost:3000`

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start the development server
npm start
```

The app will be available at `http://localhost:4200`

### 3. MongoDB Setup

Make sure MongoDB is running locally or update the `.env` file with your MongoDB Atlas URI:

```env
MONGODB_URI=mongodb://localhost:27017/sharda_papers
```

## CSV File Format

The application expects a CSV file with the following columns:

| Column | Description |
|--------|-------------|
| Title | Paper title |
| Authors | Semicolon-separated author names |
| Affiliations | Semicolon-separated affiliations |
| Year | Publication year |
| Source title | Journal/conference name |
| DOI | Digital Object Identifier |

### Example:

```csv
Title,Authors,Affiliations,Year,Source title,DOI
Machine Learning Advances,John Doe;Jane Smith,Sharda University;MIT,2024,Journal of AI,10.1234/example
```

## Sharda University Affiliation Keywords

The application filters for authors affiliated with Sharda University using these keywords:
- "Sharda University"
- "Greater Noida"
- "School of Engineering and Technology, Sharda"
- And more (see `paperController.js`)

## Development

### Running Backend

```bash
cd backend
npm run dev  # Uses nodemon for auto-reload
```

### Running Frontend

```bash
cd frontend
ng serve
```

## License

MIT
