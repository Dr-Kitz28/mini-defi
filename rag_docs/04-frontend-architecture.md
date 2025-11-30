# Frontend Architecture

## Technology Stack

- **HTML5** - Semantic markup with accessibility features
- **CSS3** - Modern styling with CSS variables, flexbox, grid
- **Vanilla JavaScript** - No frameworks, pure ES6+
- **ethers.js** - Ethereum interaction library
- **http-server** - Simple static file server

## File Structure

```
frontend/
├── index.html      # Main HTML page
├── styles.css      # All CSS styles
├── app.js          # Main application logic
├── config.json     # Configuration
└── deployed-contracts.json  # Contract addresses
```

## Key Features

### Theme System
- Light and Dark mode toggle
- Duolingo-style 3D buttons with hover/click effects
- Adjustable contrast levels (Low, Medium, High, Very High)
- Settings panel in bottom-right corner

### Wallet Integration
- MetaMask connection via ethers.js
- Automatic network detection
- Account change handling
- Transaction signing

### Asset Management
- Load 100+ assets from deployed contracts
- Category filtering (Stablecoins, DeFi, Layer 2, etc.)
- Search by name or symbol
- Multi-select for batch operations

### Batch Operations
- Select multiple assets at once
- Set proportions for each (must total 100%)
- Execute single transaction for multiple assets
- Gas-efficient compared to individual transactions

### AI Chat Assistant
- OpenAI API integration (GPT-4o-mini)
- Local fallback responses when API unavailable
- Local RAG mode with Mistral-7B
- Commands: /local, /status, /setkey, /clearkey

## CSS Architecture

### Design System (8-Point Spacing)
```css
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
```

### Typography Scale
```css
--text-xs: 0.75rem;   /* 12px */
--text-sm: 0.875rem;  /* 14px */
--text-base: 1rem;    /* 16px */
--text-lg: 1.125rem;  /* 18px */
--text-xl: 1.25rem;   /* 20px */
--text-2xl: 1.5rem;   /* 24px */
--text-3xl: 1.875rem; /* 30px */
--text-4xl: 2.25rem;  /* 36px */
```

### Color Variables
```css
/* Light theme */
--bg-primary: #f5f5f5;
--text-primary: #1a1a2e;
--accent: #4a90d9;

/* Dark theme */
--bg-primary: #0f0f1a;
--text-primary: #e8e8f0;
--accent: #5a9fea;
```

### Responsive Breakpoints
- Mobile: < 480px
- Tablet: 480px - 768px
- Desktop: 768px - 1024px
- Large: 1024px - 1440px
- Extra Large: > 1440px

## JavaScript Architecture

### State Management
```javascript
let provider = null;           // ethers.js provider
let signer = null;             // Connected wallet signer
let lendingPoolContract = null; // LendingPool contract instance
let assets = [];               // All loaded assets
let selectedAssets = new Map(); // Selected assets with proportions
let userPositions = {};        // User's positions per asset
let currentOperation = 'deposit'; // Current operation tab
```

### Key Functions
- `connectWallet()` - Connect MetaMask
- `loadAssets()` - Load all assets from contracts
- `executeBatchOperation(type)` - Execute deposit/withdraw/borrow/repay
- `updateHealthFactor()` - Refresh health factor display
- `sendChatMessage()` - Send message to AI assistant
- `toggleTheme()` - Switch light/dark mode

### Event Handling
- Wallet connection changes
- Network changes
- Asset selection
- Tab switching
- Form submissions
- Chat interactions
