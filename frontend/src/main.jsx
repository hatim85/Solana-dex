// import { StrictMode } from 'react'
// import { createRoot } from 'react-dom/client'
// import App from './App.jsx'
// import './index.css'

// import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
// import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
// import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'

// const wallets = [new PhantomWalletAdapter()]
// const endpoint = 'https://api.devnet.solana.com'

// createRoot(document.getElementById('root')).render(
//   <StrictMode>
//     <ConnectionProvider endpoint={endpoint}>
//       <WalletProvider wallets={wallets} autoConnect>
//         <WalletModalProvider>
//           <App />
//         </WalletModalProvider>
//       </WalletProvider>
//     </ConnectionProvider>
//   </StrictMode>,
// )


import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);