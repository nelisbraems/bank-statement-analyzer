# Bank Statement Analyzer

## Project Overview
A full-stack React application for analyzing Belgian bank statement CSV exports. Stores transactions in MongoDB, supports flexible grouping/aggregation, and visualizes spending patterns.

## Tech Stack
**Frontend:**
- React 18 + Vite
- Tailwind CSS v4
- Papaparse (CSV parsing)
- Lucide React (icons)

**Backend:**
- Node.js + Express
- MongoDB

## Project Structure
```
bank-statement-analyzer/
├── src/
│   ├── App.jsx          # Main React component
│   ├── main.jsx         # React entry point
│   └── index.css        # Tailwind import
├── server.js            # Express API server
├── package.json
├── postcss.config.js
└── CLAUDE.md
```

## Commands
```bash
# Start MongoDB (if local)
mongod

# Start backend server
node server.js

# Start frontend dev server (separate terminal)
npm run dev
```

## API Endpoints

### Transactions
- `POST /api/transactions/import` - Bulk import transactions
- `GET /api/transactions` - List transactions with filters
- `PATCH /api/transactions/:id` - Update a transaction
- `DELETE /api/transactions` - Delete all transactions

### Aggregation
- `GET /api/transactions/aggregate?groupBy=category` - Group transactions
  - groupBy options: `category`, `counterparty`, `type`, `month`, `year`, `day`
- `GET /api/transactions/summary` - Get income/expense totals
- `GET /api/transactions/distinct/:field` - Get unique values for filters

### Query Parameters (for filtering)
- `category` - Filter by category
- `counterparty` - Filter by counterparty (partial match)
- `type` - Filter by transaction type
- `minAmount` / `maxAmount` - Amount range
- `startDate` / `endDate` - Date range
- `sortBy` / `sortOrder` - Sorting
- `limit` / `skip` - Pagination

## MongoDB Schema
```js
{
  date: String,           // Original date string
  dateObj: Date,          // Parsed Date for queries
  description: String,
  amount: Number,
  category: String,
  counterparty: String,
  type: String,
  status: String,
  importedAt: Date
}
```

## Environment Variables
```
MONGO_URI=mongodb://localhost:27017
PORT=3001
```

## Setup Instructions
1. Install MongoDB locally or use MongoDB Atlas
2. Run `npm install` for frontend deps
3. Run `npm install express cors mongodb` for backend deps
4. Start MongoDB: `mongod`
5. Start backend: `node server.js`
6. Start frontend: `npm run dev`

## Features
- [x] CSV upload with column mapping
- [x] Auto-categorization
- [x] MongoDB storage
- [x] Flexible aggregation/grouping
- [ ] Date range filtering UI
- [ ] Group-by selector in UI
- [ ] Charts with Recharts
- [ ] Export to PDF/CSV
- [ ] Custom category rules
- [ ] Dark mode

## Code Conventions
- Frontend: React functional components with hooks
- Backend: Express with async/await
- MongoDB: Native driver (not Mongoose)