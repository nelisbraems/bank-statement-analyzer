# Bank Statement Analyzer

## Project Overview
A React application for analyzing Belgian bank statement CSV exports. Automatically categorizes transactions, calculates income/expenses, and visualizes spending patterns.

## Tech Stack
- **Framework:** React 18 + Vite
- **Styling:** Tailwind CSS v4 (via @tailwindcss/vite plugin)
- **CSV Parsing:** Papaparse
- **Icons:** Lucide React

## Commands
```bash
npm run dev      # Start development server (http://localhost:5173)
npm run build    # Create production build
npm run preview  # Preview production build locally
```

## Project Structure
```
src/
├── App.jsx      # Main component with all application logic
├── main.jsx     # React entry point
└── index.css    # Tailwind CSS import
```

## Key Features
- CSV file upload with drag & drop support
- Auto-detection of Belgian bank column formats (KBC, BNP, ING, Belfius)
- Manual column mapping interface
- Transaction categorization (Groceries, Dining, Transportation, etc.)
- Income/Expense/Net balance summary
- Category breakdown with percentage bars
- Transaction history table sorted by date

## Belgian Bank Support
The app recognizes Dutch column names:
- `Uitvoeringsdatum` → Date
- `Bedrag` → Amount
- `Mededeling` → Description
- `Naam van de tegenpartij` → Counterparty
- `Type verrichting` → Transaction type
- `Status` → Status (filters out "geweigerd"/rejected)

## Category Keywords
Transactions are auto-categorized based on description keywords:
- **Groceries:** Delhaize, Colruyt, Carrefour, Aldi, Lidl
- **Dining:** restaurant, cafe, resto, horeca, pizza
- **Transportation:** NMBS, De Lijn, Shell, Q8, Total, benzine
- **Utilities:** Proximus, Telenet, Engie, Luminus
- **Shopping:** Amazon, Bol.com, Coolblue, Zalando
- **Entertainment:** Netflix, Spotify, Streamz, Disney
- **Health & Fitness:** Basic-Fit, apotheek, pharmacy

## Potential Improvements
- [ ] Add date range filtering
- [ ] Export analysis to PDF/CSV
- [ ] Custom category rules (user-defined keywords)
- [ ] Charts with Recharts (pie chart, monthly trends)
- [ ] Multi-file upload for combining statements
- [ ] Persist category rules to localStorage
- [ ] Dark mode support
- [ ] Monthly/yearly comparison views
- [ ] Search/filter transactions
- [ ] Edit transaction categories manually

## Code Conventions
- Single-file component architecture (App.jsx contains all logic)
- Tailwind utility classes for styling
- State managed with React useState hooks
- Papaparse with `dynamicTyping` and `delimitersToGuess` for robust CSV parsing

## Notes
- European number format supported (comma as decimal separator)
- Handles both comma and semicolon CSV delimiters
- Filters out rejected transactions (status contains "geweigerd")
- Transactions sorted newest-first by default