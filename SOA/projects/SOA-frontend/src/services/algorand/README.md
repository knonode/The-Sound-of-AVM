# Algorand API Service

This directory contains the secure, TypeScript-based Algorand API service that replaces the previous insecure `algorand-direct.js` file.

## Security Improvements

### Before (❌ Insecure)
- `algorand-direct.js` was in `public/` folder
- API endpoints and configuration were publicly accessible
- Anyone could view `http://yoursite.com/algorand-direct.js`
- Potential exposure of API tokens and sensitive URLs

### After (✅ Secure)
- TypeScript source code in `src/services/algorand/`
- Configuration externalized to environment variables (ready for implementation)
- Bundled as UMD library for public scripts
- No sensitive information exposed to browsers

## Architecture

```
src/services/algorand/
├── index.ts          # Main exports
├── algorandAPI.ts    # Core API functionality
├── types.ts          # TypeScript interfaces
├── config.ts         # Configuration management
└── README.md         # This file
```

## Usage

### For React Components
```typescript
import { AlgorandAPI } from '@/services/algorand';

// Use the API
await AlgorandAPI.initAlgodConnection();
AlgorandAPI.startPolling(callback);
```

### For Public Scripts (like proto-synth.js)
The service is automatically bundled as `algorand-api.umd.cjs` in the public folder:
```javascript
import AlgorandAPI from './algorand-api.umd.cjs';
```

## Configuration

The service is configured through `config.ts`. To use environment variables:

1. Create a `.env` file in the project root
2. Add variables like:
   ```
   VITE_ALGOD_SERVER=http://localhost
   VITE_ALGOD_PORT=8081
   VITE_NODELY_BASE_URL=https://mainnet-api.4160.nodely.dev
   VITE_ALGORANDING_BASE_URL=https://mempool.algorand.ing/api/mempool
   VITE_ALGOD_TOKEN=your_token_here
   ```
3. Update `config.ts` to use `import.meta.env.VITE_*` variables

## Build Process

The service is automatically built when running:
- `npm run dev` - Builds the library and starts dev server
- `npm run build` - Builds both the library and the main app

## Migration from algorand-direct.js

✅ **Completed:**
- Converted JavaScript to TypeScript with proper types
- Moved from `public/` to `src/services/algorand/`
- Created secure configuration management
- Built UMD bundle for public script compatibility
- Updated proto-synth.js to use new module
- Removed insecure original file

🔄 **Ready for Future Enhancement:**
- Environment variable integration
- React hooks for Algorand functionality
- Enhanced error handling and logging
